use crate::bitboards::{Bitboard, contains, positions};
use crate::incremental::Evaluator;
use crate::moves::{Candidate, Candidates, MoveOrdering, PolicyScoring, SearchSelection, generate_for_search};
use crate::rules::{self, BoardResult};
use crate::transposition::{Bound, CacheKey, Entry, Table, from_table, to_table};
use crate::zobrist::Hasher;
use std::collections::HashMap;

pub const WIN_SCORE: i32 = 1_000_000;
const INFINITY: i32 = 2_000_000;
const ASPIRATION_DELTA: i32 = 1024;
/// Clamp for main-history entries and the cap on the per-move depth bonus.
const HISTORY_CLAMP: i32 = 8192;
const HISTORY_BONUS_CAP: i32 = 2048;
fn history_bonus(depth: usize) -> i32 {
    (depth * depth * 8).min(HISTORY_BONUS_CAP as usize) as i32
}
#[derive(Clone, Copy, Debug)]
pub struct ResultLine {
    pub score: i32,
    pub pv: [u16; 225],
    pub length: usize,
}
impl ResultLine {
    pub fn quiet(score: i32) -> Self {
        Self {
            score,
            pv: [0; 225],
            length: 0,
        }
    }
    fn prepend(position: usize, child: Self) -> Self {
        let mut result = Self::quiet(child.score);
        result.pv[0] = position as u16;
        result.length = (child.length + 1).min(225);
        result.pv[1..result.length].copy_from_slice(&child.pv[..result.length - 1]);
        result
    }
    fn single(score: i32, position: usize) -> Self {
        Self::prepend(position, Self::quiet(score))
    }
}
pub struct Iteration {
    pub depth: usize,
    pub result: ResultLine,
    pub nodes: u64,
    pub hits: u64,
    pub cutoffs: u64,
    pub table_size: usize,
}
impl Iteration {
    pub fn packed(&self) -> Vec<f64> {
        let mut result = vec![
            self.depth as f64,
            self.result.score as f64,
            self.nodes as f64,
            self.hits as f64,
            self.cutoffs as f64,
            self.table_size as f64,
            self.result.length as f64,
        ];
        result.extend(
            self.result.pv[..self.result.length]
                .iter()
                .map(|&p| p as f64),
        );
        result
    }
}
/// Synchronous iterations with optional limits. An iteration that a limit cuts
/// publishes the best root move whose subtree completed and already beat the
/// previous line, so a cut iteration is only abandoned when nothing improved.
pub struct Search {
    pub state: Evaluator,
    pub hasher: Hasher,
    table: Option<Table>,
    perspective: bool,
    max_depth: usize,
    extension: usize,
    next_depth: usize,
    done: bool,
    previous: ResultLine,
    path: [u16; 225],
    buffers: Vec<Candidates>,
    nodes: u64,
    /// Nodes already spent on this move, aborted iterations included.
    spent: u64,
    /// Whole-move node budget; zero leaves deepening unbounded.
    node_budget: u64,
    /// Set when the budget stopped the search before its allocated depth.
    exhausted: bool,
    /// Times a visit was refused, so a root move can tell whether the subtree it
    /// started was searched to the end.
    aborted: u64,
    /// Best root move among the children that completed before a cut.
    partial: Option<ResultLine>,
    /// Hard wall-clock deadline for this move. Native builds only: `Instant::now`
    /// is unavailable on `wasm32-unknown-unknown`, where Wasm callers use the
    /// node budget instead.
    #[cfg(not(target_arch = "wasm32"))]
    deadline: Option<std::time::Instant>,
    hits: u64,
    cutoffs: u64,
    // Full occupancy and attacker verify identity; proof lengths stay relative
    // to this position, so callers can apply their own root distance.
    vcf_cache: HashMap<(Bitboard, Bitboard, bool), Option<(Vec<u16>, usize)>>,
    use_pvs: bool,
    protect_forcing: bool,
    candidate_width: Option<usize>,
    root_width: Option<usize>,
    policy: Option<crate::policy::Policy>,
    policy_scale: f32,
    policy_plies: usize,
    lmr_start: usize,
    use_tier: bool,
    use_history: bool,
    use_tt_move: bool,
    stop_on_mate: bool,
    /// Whether an iteration cut by a limit may still supply the move. Off by
    /// default: over 300 equal-time games the direction favoured keeping the last
    /// completed iteration (19 wins against 14), consistently within each seed.
    play_cuts: bool,
    use_eval_order: bool,
    eval_order_root_only: bool,
    /// Main-history cutoff statistics, indexed by side to move and square.
    history: [[i32; 225]; 2],
    /// Best reply found to the opponent's previous move, indexed by side and square.
    counter: [[u16; 225]; 2],
    /// Killer moves per ply; `u16::MAX` when unset.
    killers: [[u16; 2]; 225],
}
impl Search {
    pub fn new(
        black: Bitboard,
        white: Bitboard,
        perspective: bool,
        max_depth: usize,
        extension: usize,
        capacity: usize,
    ) -> Result<Self, &'static str> {
        Self::with_state(
            Evaluator::new(black, white, perspective),
            perspective,
            max_depth,
            extension,
            capacity,
        )
    }
    pub fn with_state(
        state: Evaluator,
        perspective: bool,
        max_depth: usize,
        extension: usize,
        capacity: usize,
    ) -> Result<Self, &'static str> {
        let black = state.black;
        let white = state.white;
        if max_depth > 225 {
            return Err("Search depth must be between 0 and 225");
        }
        if extension > 225 {
            return Err("Tactical extension must be between 0 and 225");
        }
        if capacity > 1_000_000 {
            return Err("Table capacity must not exceed 1000000");
        }
        let terminal = rules::result(&black, &white).is_some();
        Ok(Self {
            state,
            hasher: Hasher::new(&black, &white, perspective),
            table: if capacity == 0 {
                None
            } else {
                Some(Table::new(capacity))
            },
            perspective,
            max_depth,
            extension,
            next_depth: 1,
            done: terminal || max_depth == 0,
            previous: ResultLine::quiet(0),
            path: [0; 225],
            buffers: (0..=max_depth).map(|_| Candidates::default()).collect(),
            nodes: 0,
            spent: 0,
            node_budget: 0,
            exhausted: false,
            aborted: 0,
            partial: None,
            #[cfg(not(target_arch = "wasm32"))]
            deadline: None,
            hits: 0,
            cutoffs: 0,
            vcf_cache: HashMap::new(),
            use_pvs: true,
            protect_forcing: true,
            candidate_width: None,
            root_width: None,
            policy: None,
            policy_scale: 1000.0,
            policy_plies: 1,
            lmr_start: 0,
            use_tier: false,
            use_history: false,
            use_tt_move: false,
            stop_on_mate: true,
            play_cuts: false,
            use_eval_order: true,
            eval_order_root_only: false,
            history: [[0; 225]; 2],
            counter: [[u16::MAX; 225]; 2],
            killers: [[u16::MAX; 2]; 225],
        })
    }
    /// Diagnostic reference mode. A running search cannot mix cache semantics.
    pub fn set_pvs(&mut self, enabled: bool) -> Result<(), &'static str> {
        if self.nodes != 0 || self.next_depth != 1 {
            return Err("PVS mode must be selected before search starts");
        }
        self.use_pvs = enabled;
        Ok(())
    }
    pub fn set_forcing_moves(&mut self, enabled: bool) -> Result<(), &'static str> {
        if self.nodes != 0 || self.next_depth != 1 {
            return Err("Forcing-move mode must be selected before search starts");
        }
        self.protect_forcing = enabled;
        Ok(())
    }
    /// Whole-move node budget (0 disables it). Depth one is never bounded, so a
    /// limited search still completes an iteration and returns a line.
    pub fn set_node_budget(&mut self, budget: u64) -> Result<(), &'static str> {
        if budget > 1_000_000_000 {
            return Err("Node budget must not exceed 1000000000");
        }
        if self.nodes != 0 || self.next_depth != 1 {
            return Err("Node budget must be selected before search starts");
        }
        self.node_budget = budget;
        Ok(())
    }
    /// Nodes visited for this move, completed and aborted iterations alike.
    pub fn total_nodes(&self) -> u64 {
        self.spent
    }
    /// True when the node budget ended deepening before the allocated depth.
    pub fn budget_exhausted(&self) -> bool {
        self.exhausted
    }
    /// Hard wall-clock deadline for the whole move. Native builds only: the clock
    /// is read here rather than in the shared search algebra, because
    /// `Instant::now` is unavailable on `wasm32-unknown-unknown`.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn set_deadline(
        &mut self,
        deadline: Option<std::time::Instant>,
    ) -> Result<(), &'static str> {
        if self.nodes != 0 || self.next_depth != 1 {
            return Err("Deadline must be selected before search starts");
        }
        self.deadline = deadline;
        Ok(())
    }
    /// Whether a cut iteration may still supply the move. Off by default; the
    /// last completed iteration is kept instead, which the equal-time A/B over
    /// three seeds favored (19 wins to 14 over 300 games).
    pub fn set_cut_playback(&mut self, enabled: bool) -> Result<(), &'static str> {
        if self.nodes != 0 || self.next_depth != 1 {
            return Err("Cut playback must be selected before search starts");
        }
        self.play_cuts = enabled;
        Ok(())
    }
    /// Diagnostic fixed width; tactical candidates remain protected.
    pub fn set_candidate_width(&mut self, width: usize) -> Result<(), &'static str> {
        if !(1..=225).contains(&width) || self.nodes != 0 || self.next_depth != 1 {
            return Err("Candidate width must be 1..225 and selected before search starts");
        }
        self.candidate_width = Some(width);
        Ok(())
    }
    /// Diagnostic root-only width; deeper nodes keep the depth policy.
    pub fn set_root_width(&mut self, width: usize) -> Result<(), &'static str> {
        if !(1..=225).contains(&width) || self.nodes != 0 || self.next_depth != 1 {
            return Err("Root width must be 1..225 and selected before search starts");
        }
        self.root_width = Some(width);
        Ok(())
    }
    /// Candidate-ordering policy applied at the root; loaded before the search starts.
    pub fn set_policy(&mut self, bytes: &[u8], scale: f32) -> Result<(), &'static str> {
        if !scale.is_finite() || !(1.0..=100_000.0).contains(&scale) {
            return Err("Policy scale must be between 1 and 100000");
        }
        if self.nodes != 0 || self.next_depth != 1 {
            return Err("Policy must be selected before search starts");
        }
        self.policy = Some(crate::policy::Policy::load(bytes)?);
        self.policy_scale = scale;
        Ok(())
    }
    /// Number of topmost plies that use the policy ordering (1 = root only).
    pub fn set_policy_plies(&mut self, plies: usize) -> Result<(), &'static str> {
        if plies > 225 {
            return Err("Policy plies must be 0..225");
        }
        if self.nodes != 0 || self.next_depth != 1 {
            return Err("Policy plies must be selected before search starts");
        }
        self.policy_plies = plies;
        Ok(())
    }
    /// Late-move reduction start index (0 disables). Moves at or after this
    /// order position are first searched at reduced depth, then re-searched on
    /// an alpha improvement.
    pub fn set_lmr(&mut self, start: usize) -> Result<(), &'static str> {
        if start > 225 {
            return Err("LMR start must be 0..225");
        }
        if self.nodes != 0 || self.next_depth != 1 {
            return Err("LMR must be selected before search starts");
        }
        self.lmr_start = start;
        Ok(())
    }
    /// Promote open-three-creating moves in the candidate ordering.
    pub fn set_tier(&mut self, enabled: bool) -> Result<(), &'static str> {
        if self.nodes != 0 || self.next_depth != 1 {
            return Err("Tier ordering must be selected before search starts");
        }
        self.use_tier = enabled;
        Ok(())
    }
    /// Enable dynamic interior ordering from main history, countermoves and killers.
    pub fn set_history(&mut self, enabled: bool) -> Result<(), &'static str> {
        if self.nodes != 0 || self.next_depth != 1 {
            return Err("History ordering must be selected before search starts");
        }
        self.use_history = enabled;
        Ok(())
    }
    /// Try the transposition table's stored best move first at every node.
    pub fn set_tt_move(&mut self, enabled: bool) -> Result<(), &'static str> {
        if self.nodes != 0 || self.next_depth != 1 {
            return Err("TT-move ordering must be selected before search starts");
        }
        self.use_tt_move = enabled;
        Ok(())
    }
    /// Weight of the tempo-aware initiative term (0 keeps the linear evaluator).
    pub fn set_initiative(&mut self, value: i32) -> Result<(), &'static str> {
        if self.nodes != 0 || self.next_depth != 1 {
            return Err("Initiative weight must be selected before search starts");
        }
        self.state.set_initiative(value)
    }
    /// Whether a mate-sized iteration score ends iterative deepening immediately.
    /// Disabling it searches to full depth, so deeper iterations can refute a
    /// selectively-derived (unsound) mate claim.
    pub fn set_mate_stop(&mut self, enabled: bool) -> Result<(), &'static str> {
        if self.nodes != 0 || self.next_depth != 1 {
            return Err("Mate handling must be selected before search starts");
        }
        self.stop_on_mate = enabled;
        Ok(())
    }
    /// Order quiet candidates by the shallow evaluation of the resulting position.
    /// 0 disables it, 1 orders at every node, 2 orders at the root only.
    pub fn set_eval_order(&mut self, level: u8) -> Result<(), &'static str> {
        if self.nodes != 0 || self.next_depth != 1 {
            return Err("Evaluation ordering must be selected before search starts");
        }
        if level > 2 {
            return Err("Evaluation ordering level must be 0, 1 or 2");
        }
        self.use_eval_order = level != 0;
        self.eval_order_root_only = level == 2;
        Ok(())
    }
    /// An ordering hint for the first iteration, replaced by the completed PV.
    pub fn prefer_root(&mut self, position: usize) -> Result<(), &'static str> {
        if self.next_depth != 1
            || position >= 225
            || contains(&self.state.black, position)
            || contains(&self.state.white, position)
        {
            return Err("Root preference must be an empty square before search starts");
        }
        self.previous = ResultLine::single(0, position);
        Ok(())
    }
    /// Search the root with an aspiration window seeded by the previous depth's
    /// score. A fail-low or fail-high opens the offending bound and repeats; the
    /// completed result equals the full-window search.
    fn aspiration(&mut self, depth: usize) -> Result<ResultLine, &'static str> {
        if depth <= 1 {
            return self.minimax(depth, -INFINITY, INFINITY, true, 0);
        }
        let mut alpha = self.previous.score - ASPIRATION_DELTA;
        let mut beta = self.previous.score + ASPIRATION_DELTA;
        loop {
            let result = self.minimax(depth, alpha, beta, true, 0)?;
            // An aborted iteration is discarded, so repeating a window is waste.
            if self.exhausted {
                return Ok(result);
            }
            if result.score <= alpha {
                alpha = -INFINITY;
            } else if result.score >= beta {
                beta = INFINITY;
            } else {
                return Ok(result);
            }
        }
    }

    pub fn next_iteration(&mut self) -> Result<Option<Iteration>, &'static str> {
        if self.done {
            return Ok(None);
        }
        // A spent budget stops deepening without discarding the completed line.
        if self.next_depth > 1 && self.node_budget != 0 && self.spent >= self.node_budget {
            self.exhausted = true;
            self.done = true;
            return Ok(None);
        }
        // Diagnostic fixed searches may use the opposite side at the root.
        self.hasher = Hasher::new(&self.state.black, &self.state.white, self.perspective);
        let depth = self.next_depth;
        let hits = self.hits;
        let cutoffs = self.cutoffs;
        self.nodes = 0;
        self.aborted = 0;
        self.partial = None;
        let result = self.aspiration(depth)?;
        self.spent += self.nodes;
        if self.exhausted {
            self.done = true;
            // A cut iteration keeps the best root move whose subtree completed, so
            // the work done before the cut is not thrown away.
            let published = if self.play_cuts {
                self.partial.take()
            } else {
                None
            };
            if let Some(line) = published {
                self.previous = line;
                self.next_depth += 1;
                return Ok(Some(Iteration {
                    depth,
                    result: line,
                    nodes: self.nodes,
                    hits: self.hits - hits,
                    cutoffs: self.cutoffs - cutoffs,
                    table_size: self.table.as_ref().map_or(0, Table::len),
                }));
            }
            return Ok(None);
        }
        if result.length == 0 {
            self.done = true;
            return Ok(None);
        }
        self.previous = result;
        self.next_depth += 1;
        self.done = depth >= self.max_depth
            || (self.stop_on_mate && result.score.abs() >= WIN_SCORE - 225);
        Ok(Some(Iteration {
            depth,
            result,
            nodes: self.nodes,
            hits: self.hits - hits,
            cutoffs: self.cutoffs - cutoffs,
            table_size: self.table.as_ref().map_or(0, Table::len),
        }))
    }
    pub fn fixed(
        &mut self,
        depth: usize,
        maximizing: bool,
        alpha: i32,
        beta: i32,
    ) -> Result<Iteration, &'static str> {
        if depth > self.max_depth {
            return Err("Depth exceeds allocated search depth");
        }
        if alpha >= beta {
            return Err("Alpha must be below beta");
        }
        self.nodes = 0;
        let hits = self.hits;
        let cutoffs = self.cutoffs;
        // The hash includes the actual side to move even when testing a minimizing root.
        self.hasher = Hasher::new(
            &self.state.black,
            &self.state.white,
            if maximizing {
                self.perspective
            } else {
                !self.perspective
            },
        );
        let result = self.minimax(depth, alpha, beta, maximizing, 0)?;
        Ok(Iteration {
            depth,
            result,
            nodes: self.nodes,
            hits: self.hits - hits,
            cutoffs: self.cutoffs - cutoffs,
            table_size: self.table.as_ref().map_or(0, Table::len),
        })
    }
    fn follows_pv(&self, ply: usize) -> bool {
        ply <= self.previous.length && self.path[..ply] == self.previous.pv[..ply]
    }
    /// True when visiting another node would exceed a limit. Depth one is exempt,
    /// so a limited search always completes an iteration and returns a line.
    fn limit_reached(&self) -> bool {
        self.next_depth > 1 && (self.budget_exceeded() || self.deadline_due())
    }
    /// True when the visit would exceed the whole-move node budget.
    fn budget_exceeded(&self) -> bool {
        self.node_budget != 0 && self.spent + self.nodes >= self.node_budget
    }
    /// Reads the clock once per 256 nodes: exact enough for a deadline, and the
    /// node budget already covers exactness.
    fn deadline_due(&self) -> bool {
        #[cfg(not(target_arch = "wasm32"))]
        {
            if let Some(deadline) = self.deadline {
                return self.nodes & 0xFF == 0 && std::time::Instant::now() >= deadline;
            }
        }
        false
    }
    fn key(&self, depth: usize, ply: usize) -> CacheKey {
        let suffix = if self.follows_pv(ply) && ply < self.previous.length {
            self.previous.pv[ply..self.previous.length].to_vec()
        } else {
            vec![]
        };
        CacheKey {
            hash: self.hasher.key(),
            depth,
            extension: self.extension,
            perspective: self.perspective,
            suffix,
        }
    }
    fn remember(
        &mut self,
        key: Option<CacheKey>,
        result: ResultLine,
        ply: usize,
        window: (i32, i32),
        exact: bool,
        to_move: bool,
    ) -> ResultLine {
        // An aborted iteration is discarded, so it must not seed the table.
        if self.exhausted {
            return result;
        }
        if let (Some(table), Some(key)) = (&mut self.table, key) {
            let bound = if exact {
                Bound::Exact
            } else if result.score <= window.0 {
                Bound::Upper
            } else if result.score >= window.1 {
                Bound::Lower
            } else {
                Bound::Exact
            };
            let mut stored = result;
            stored.score = to_table(result.score, ply);
            table.store(
                key,
                Entry {
                    black: self.state.black,
                    white: self.state.white,
                    to_move,
                    result: stored,
                    bound,
                },
            );
        }
        result
    }
    fn horizon(
        &mut self,
        maximizing: bool,
        ply: usize,
        remaining: usize,
    ) -> Result<ResultLine, &'static str> {
        let own = if maximizing {
            self.perspective
        } else {
            !self.perspective
        };
        let (wins, threats) = if own {
            (&self.state.winning.black, &self.state.winning.white)
        } else {
            (&self.state.winning.white, &self.state.winning.black)
        };
        if wins.count > 0 {
            let p = positions(&wins.board, &[0; 8], false)
                .next()
                .expect("cached winning count");
            return Ok(ResultLine::single(
                if maximizing {
                    WIN_SCORE - ply as i32 - 1
                } else {
                    -WIN_SCORE + ply as i32 + 1
                },
                p,
            ));
        }
        if threats.count >= 2 {
            let mut ps = positions(&threats.board, &[0; 8], false);
            let block = ps.next().expect("cached count");
            let win = ps.next().expect("multiple threats");
            let score = if maximizing {
                -WIN_SCORE + ply as i32 + 2
            } else {
                WIN_SCORE - ply as i32 - 2
            };
            return Ok(ResultLine::prepend(block, ResultLine::single(score, win)));
        }
        if threats.count == 0 || remaining == 0 {
            if threats.count == 0 && remaining > 0 && crate::vct::can_start(&self.state.lines, own)
            {
                let key = (self.state.black, self.state.white, own);
                let proof = if let Some(cached) = self.vcf_cache.get(&key) {
                    cached.clone()
                } else {
                    let proof = crate::vct::solve(
                        &mut self.state.lines,
                        &mut self.state.winning,
                        own,
                        crate::vct::HORIZON_PLIES,
                        crate::vct::HORIZON_NODES,
                    );
                    if self.vcf_cache.len() >= 2048 {
                        self.vcf_cache.clear();
                    }
                    let entry = proof.line.clone().map(|line| (line, proof.plies));
                    self.vcf_cache.insert(key, entry.clone());
                    entry
                };
                if let Some((line, plies)) = proof {
                    let distance = (ply + plies) as i32;
                    let mut result = ResultLine::quiet(if maximizing {
                        WIN_SCORE - distance
                    } else {
                        -WIN_SCORE + distance
                    });
                    result.length = line.len();
                    result.pv[..line.len()].copy_from_slice(&line);
                    return Ok(result);
                }
            }
            return Ok(ResultLine::quiet(self.state.score_for_turn(
                if maximizing {
                    self.perspective
                } else {
                    !self.perspective
                },
            )));
        }
        let p = positions(&threats.board, &[0; 8], false)
            .next()
            .expect("cached threat count");
        if self.limit_reached() {
            self.exhausted = true;
            self.aborted += 1;
            return Ok(ResultLine::quiet(0));
        }
        let token = self.state.make_leaf_move(p, own)?;
        self.hasher.toggle(p, own);
        self.nodes += 1;
        let child = self.horizon(!maximizing, ply + 1, remaining - 1);
        self.hasher.toggle(p, own);
        self.state.undo_move(token)?;
        Ok(ResultLine::prepend(p, child?))
    }
    #[cfg(test)]
    fn select(&mut self, depth: usize, ply: usize) {
        let follows = self.follows_pv(ply);
        let preferred = if follows && ply < self.previous.length {
            Some(self.previous.pv[ply] as usize)
        } else {
            None
        };
        let candidates = &mut self.buffers[ply];
        let wins = candidates
            .as_slice()
            .iter()
            .filter(|m| m.tactical == Some(2))
            .count();
        let blocks = candidates
            .as_slice()
            .iter()
            .filter(|m| m.tactical == Some(1))
            .count();
        if wins == 0 && blocks == 1 {
            let block = *candidates
                .as_slice()
                .iter()
                .find(|m| m.tactical == Some(1))
                .expect("one block");
            candidates.moves[0] = block;
            candidates.len = 1;
            return;
        }
        if wins > 0 {
            candidates.len = wins;
        }
        let eligible = candidates.len;
        let tactics = candidates
            .as_slice()
            .iter()
            .filter(|m| m.tactical.is_some_and(|t| t > 0))
            .count();
        let cap = 20usize.saturating_sub(depth * 2).max(8).max(tactics);
        candidates.len = eligible.min(cap);
        if let Some(p) = preferred
            && let Some(index) = candidates.moves[..eligible]
                .iter()
                .position(|m| m.position == p)
        {
            let candidate = candidates.moves[index];
            if index < candidates.len {
                candidates.moves[..=index].rotate_right(1);
            } else {
                if let Some(remove) = candidates
                    .as_slice()
                    .iter()
                    .rposition(|m| m.tactical.is_none_or(|t| t == 0))
                {
                    candidates.moves[remove..candidates.len].rotate_left(1);
                    candidates.len -= 1;
                }
                candidates.moves[..=candidates.len].rotate_right(1);
                candidates.moves[0] = candidate;
                candidates.len += 1;
            }
        }
    }
    /// Update main history, countermove and killers after searching a quiet move.
    fn record_move(&mut self, color: bool, position: usize, ply: usize, depth: usize, cutoff: bool) {
        let bonus = history_bonus(depth);
        let entry = &mut self.history[usize::from(color)][position];
        *entry = if cutoff {
            (*entry + bonus).min(HISTORY_CLAMP)
        } else {
            (*entry - bonus).max(-HISTORY_CLAMP)
        };
        if cutoff {
            let previous = self.path[ply - 1] as usize;
            self.counter[usize::from(!color)][previous] = position as u16;
            if self.killers[ply][0] != position as u16 {
                self.killers[ply][1] = self.killers[ply][0];
                self.killers[ply][0] = position as u16;
            }
        }
    }
    fn minimax(
        &mut self,
        depth: usize,
        mut alpha: i32,
        mut beta: i32,
        maximizing: bool,
        ply: usize,
    ) -> Result<ResultLine, &'static str> {
        if self.limit_reached() {
            self.exhausted = true;
            self.aborted += 1;
            return Ok(ResultLine::quiet(0));
        }
        self.nodes += 1;
        if ply == 0 {
            if let Some(result) = rules::result(&self.state.black, &self.state.white) {
                let score = match result {
                    BoardResult::Winner(color) => {
                        if color == self.perspective {
                            WIN_SCORE
                        } else {
                            -WIN_SCORE
                        }
                    }
                    _ => 0,
                };
                return Ok(ResultLine::quiet(score));
            }
        } else {
            let last_player = if maximizing {
                !self.perspective
            } else {
                self.perspective
            };
            if rules::win(
                if last_player {
                    &self.state.black
                } else {
                    &self.state.white
                },
                self.path[ply - 1] as usize,
            ) {
                return Ok(ResultLine::quiet(if last_player == self.perspective {
                    WIN_SCORE - ply as i32
                } else {
                    -WIN_SCORE + ply as i32
                }));
            }
        }
        // Root defenses must account for an opponent's immediate fork even
        // when quiet candidate pruning would otherwise hide that reply.
        if ply == 1
            && (depth > 0 || self.extension >= 3)
            && self.state.winning.black.count == 0
            && self.state.winning.white.count == 0
        {
            let color = if maximizing {
                self.perspective
            } else {
                !self.perspective
            };
            if let Some(line) = crate::root::open_four_reply(&self.state.lines, color) {
                let mut result = ResultLine::quiet(if maximizing {
                    WIN_SCORE - 4
                } else {
                    -WIN_SCORE + 4
                });
                result.length = 3;
                result.pv[..3].copy_from_slice(&line.map(|p| p as u16));
                return Ok(result);
            }
        }
        if depth == 0 {
            return if self.extension == 0 {
                Ok(ResultLine::quiet(self.state.score_for_turn(
                    if maximizing {
                        self.perspective
                    } else {
                        !self.perspective
                    },
                )))
            } else {
                self.horizon(maximizing, ply, self.extension)
            };
        }
        let to_move = if maximizing {
            self.perspective
        } else {
            !self.perspective
        };
        let original_alpha = alpha;
        let original_beta = beta;
        let key = self.table.as_ref().map(|_| self.key(depth, ply));
        let mut tt_move = None;
        if let (Some(table), Some(key)) = (&self.table, &key)
            && let Some(entry) = table.get(key, &self.state.black, &self.state.white, to_move)
        {
            self.hits += 1;
            if self.use_tt_move && entry.result.length > 0 {
                tt_move = Some(entry.result.pv[0] as usize);
            }
            let score = from_table(entry.result.score, ply);
            if entry.bound == Bound::Exact
                || (entry.bound == Bound::Lower && score >= beta)
                || (entry.bound == Bound::Upper && score <= alpha)
            {
                self.cutoffs += 1;
                let mut result = entry.result;
                result.score = score;
                return Ok(result);
            }
        }
        let (wins, threats) = if to_move {
            (&self.state.winning.black, &self.state.winning.white)
        } else {
            (&self.state.winning.white, &self.state.winning.black)
        };
        let mandatory_block = wins.count == 0 && threats.count == 1;
        if mandatory_block {
            let position = positions(&threats.board, &[0; 8], false)
                .next()
                .expect("cached single threat");
            self.buffers[ply].moves[0] = Candidate::mandatory_block(position);
            self.buffers[ply].len = 1;
        } else {
            let preferred = tt_move.or_else(|| {
                if self.follows_pv(ply) && ply < self.previous.length {
                    Some(self.previous.pv[ply] as usize)
                } else {
                    None
                }
            });
            let scoring = if ply < self.policy_plies {
                self.policy.as_ref().map(|policy| PolicyScoring {
                    policy,
                    black: &self.state.black,
                    white: &self.state.white,
                    scale: self.policy_scale,
                })
            } else {
                None
            };
            let three = if self.use_tier {
                crate::vct::three_moves(&self.state.lines, to_move)
            } else {
                [0; 8]
            };
            let ordering = if self.use_history && ply >= 1 {
                Some(MoveOrdering {
                    history: &self.history[usize::from(to_move)],
                    counter: &self.counter[usize::from(!to_move)],
                    killers: self.killers[ply],
                    previous: self.path[ply - 1],
                })
            } else {
                None
            };
            generate_for_search(
                &self.state,
                to_move,
                &mut self.buffers[ply],
                SearchSelection {
                    depth,
                    width: if ply == 0 {
                        self.root_width.or(self.candidate_width)
                    } else {
                        self.candidate_width
                    },
                    preferred,
                    forcing: if self.protect_forcing {
                        crate::vcf::four_moves(&self.state.lines, to_move)
                    } else {
                        [0; 8]
                    },
                    eval_order: self.use_eval_order && (!self.eval_order_root_only || ply == 0),
                },
                scoring,
                three,
                ordering,
            );
        }
        if self.buffers[ply].len == 0 {
            return Ok(self.remember(
                key,
                ResultLine::quiet(0),
                ply,
                (original_alpha, original_beta),
                true,
                to_move,
            ));
        }
        let first = self.buffers[ply].moves[0];
        if first.tactical == Some(2) {
            let score = if maximizing {
                WIN_SCORE - ply as i32 - 1
            } else {
                -WIN_SCORE + ply as i32 + 1
            };
            return Ok(self.remember(
                key,
                ResultLine::single(score, first.position),
                ply,
                (original_alpha, original_beta),
                true,
                to_move,
            ));
        }
        let mut best = ResultLine::quiet(if maximizing { -INFINITY } else { INFINITY });
        // Best root move whose subtree finished. A cut iteration publishes this.
        let mut complete: Option<ResultLine> = None;
        for i in 0..self.buffers[ply].len {
            let candidate = self.buffers[ply].moves[i];
            let token = if depth == 1 {
                self.state.make_leaf_move(candidate.position, to_move)?
            } else {
                self.state.make_move(candidate.position, to_move)?
            };
            self.hasher.toggle(candidate.position, to_move);
            self.path[ply] = candidate.position as u16;
            let aborts = self.aborted;
            // The first move establishes the bound. Scout later alternatives;
            // only an improvement inside the original window needs re-search.
            // At depth one the horizon result is window-independent.
            let child =
                if self.use_pvs && i > 0 && depth > 1 && i64::from(beta) - i64::from(alpha) > 1 {
                    let (low, high) = if maximizing {
                        (alpha, alpha + 1)
                    } else {
                        (beta - 1, beta)
                    };
                    let reduction = if self.lmr_start > 0 && i >= self.lmr_start && depth > 2 {
                        (1 + (i - self.lmr_start) / 4).min(depth - 2)
                    } else {
                        0
                    };
                    self.minimax(depth - 1 - reduction, low, high, !maximizing, ply + 1)
                        .and_then(|probe| {
                            if probe.score > alpha && probe.score < beta {
                                self.minimax(depth - 1, alpha, beta, !maximizing, ply + 1)
                            } else {
                                Ok(probe)
                            }
                        })
                } else {
                    self.minimax(depth - 1, alpha, beta, !maximizing, ply + 1)
                };
            self.hasher.toggle(candidate.position, to_move);
            self.state.undo_move(token)?;
            let child = child?;
            // A root move is a candidate result only when its whole subtree was
            // searched and it already beats the previous completed line.
            if ply == 0 && self.aborted == aborts {
                let improved = if maximizing {
                    child.score > self.previous.score
                } else {
                    child.score < self.previous.score
                };
                if improved {
                    complete = Some(ResultLine::prepend(candidate.position, child));
                }
            }
            if (maximizing && child.score > best.score) || (!maximizing && child.score < best.score)
            {
                best = ResultLine::prepend(candidate.position, child);
            }
            if maximizing {
                alpha = alpha.max(child.score);
            } else {
                beta = beta.min(child.score);
            }
            let cutoff = beta <= alpha;
            if self.use_history && ply >= 1 && candidate.tactical == Some(0) && !self.exhausted {
                self.record_move(to_move, candidate.position, ply, depth, cutoff);
            }
            if cutoff {
                break;
            }
        }
        if ply == 0 && self.exhausted {
            // A cut iteration publishes its best completed root move; every other
            // branch was left partial, so it cannot be trusted with the move.
            self.partial = complete;
        }
        Ok(self.remember(
            key,
            best,
            ply,
            (original_alpha, original_beta),
            false,
            to_move,
        ))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn bits(ps: &[usize]) -> Bitboard {
        let mut b = [0; 8];
        for &p in ps {
            b[p >> 5] |= 1 << (p & 31);
        }
        b
    }
    #[test]
    fn pvs_matches_alpha_beta_and_restores_state_with_extreme_windows() {
        let b = bits(&[112, 128]);
        let w = bits(&[113, 97]);
        for perspective in [true, false] {
            for maximizing in [true, false] {
                for capacity in [0, 2, 32768] {
                    let mut reference = Search::new(b, w, perspective, 4, 4, capacity).unwrap();
                    reference.set_pvs(false).unwrap();
                    let mut pvs = Search::new(b, w, perspective, 4, 4, capacity).unwrap();
                    let expected = reference.fixed(4, maximizing, i32::MIN, i32::MAX).unwrap();
                    let actual = pvs.fixed(4, maximizing, i32::MIN, i32::MAX).unwrap();
                    assert_eq!(actual.result.score, expected.result.score);
                    assert_eq!(
                        &actual.result.pv[..actual.result.length],
                        &expected.result.pv[..expected.result.length]
                    );
                    assert_eq!(pvs.state.black, b);
                    assert_eq!(pvs.state.white, w);
                    assert_eq!(pvs.state.history_length(), 0);
                    assert!(pvs.set_pvs(false).is_err());
                }
            }
        }
    }
    #[test]
    fn horizon_vct_turn_distance_cache_and_restoration() {
        let b = bits(&[110, 111, 112, 128, 143]);
        let w = bits(&[109, 0, 14, 210, 224]);
        for perspective in [true, false] {
            let mut search = Search::new(b, w, perspective, 4, 4, 0).unwrap();
            let before = (
                search.state.lines.clone(),
                search.state.winning.clone(),
                search.hasher,
            );
            let maximizing = perspective;
            let result = search.horizon(maximizing, 0, 4).unwrap();
            assert_eq!(result.score, if maximizing { 999995 } else { -999995 });
            assert_eq!(&result.pv[..result.length], &[113, 114, 98, 83, 158]);
            assert_eq!(search.vcf_cache.len(), 1);
            assert_eq!(
                search.horizon(maximizing, 2, 4).unwrap().score,
                if maximizing { 999993 } else { -999993 }
            );
            assert_eq!(search.vcf_cache.len(), 1);
            assert!(search.horizon(!maximizing, 0, 4).unwrap().score.abs() < 500000);
            assert!(search.horizon(maximizing, 0, 0).unwrap().score.abs() < 500000);
            assert_eq!(
                (
                    search.state.lines.clone(),
                    search.state.winning.clone(),
                    search.hasher
                ),
                before
            );
            assert_eq!(search.state.history_length(), 0);
        }
    }
    #[test]
    fn forced_win_preserves_distance_and_root_state() {
        let black = bits(&[110, 111, 112, 68, 83, 98]);
        let white = bits(&[109, 53, 155, 156, 157, 0]);
        for capacity in [0, 2, 32768] {
            let mut search = Search::new(black, white, true, 4, 4, capacity).unwrap();
            let hash = search.hasher;
            let iteration = search.next_iteration().unwrap().unwrap();
            assert_eq!(iteration.result.pv[0], 113);
            assert_eq!(iteration.result.score, WIN_SCORE - 3);
            assert_eq!(search.state.black, black);
            assert_eq!(search.state.white, white);
            assert_eq!(search.state.history_length(), 0);
            assert_eq!(search.hasher, hash);
            assert!(search.next_iteration().unwrap().is_none());
        }
    }
    #[test]
    fn disabling_the_mate_stop_searches_to_full_depth() {
        let black = bits(&[110, 111, 112, 68, 83, 98]);
        let white = bits(&[109, 53, 155, 156, 157, 0]);
        let mut search = Search::new(black, white, true, 4, 4, 32768).unwrap();
        search.set_mate_stop(false).unwrap();
        let mut iterations = 0;
        let mut pv0 = None;
        let mut mate = false;
        while let Some(iteration) = search.next_iteration().unwrap() {
            iterations += 1;
            pv0 = Some(iteration.result.pv[0]);
            mate = iteration.result.score >= WIN_SCORE - 225;
        }
        assert_eq!(iterations, 4);
        assert_eq!(pv0, Some(113));
        assert!(mate);
    }
    #[test]
    fn cached_iterations_match_uncached() {
        let b = bits(&[112]);
        let w = bits(&[113, 97]);
        let mut cached = Search::new(b, w, false, 4, 4, 32768).unwrap();
        let mut reference = Search::new(b, w, false, 4, 4, 0).unwrap();
        while let Some(a) = cached.next_iteration().unwrap() {
            let r = reference.next_iteration().unwrap().unwrap();
            assert_eq!(a.depth, r.depth);
            assert_eq!(a.result.score, r.result.score);
            assert_eq!(
                &a.result.pv[..a.result.length],
                &r.result.pv[..r.result.length]
            );
        }
        assert!(reference.next_iteration().unwrap().is_none());
    }
    #[test]
    fn history_ordering_is_deterministic_and_populates_tables() {
        let b = bits(&[112, 128, 99]);
        let w = bits(&[113, 97, 127]);
        let run = || {
            let mut search = Search::new(b, w, true, 5, 4, 32768).unwrap();
            search.set_history(true).unwrap();
            let mut last = ResultLine::quiet(0);
            while let Some(iteration) = search.next_iteration().unwrap() {
                last = iteration.result;
            }
            (last, search.history, search.killers)
        };
        let (first, first_history, first_killers) = run();
        let (second, second_history, second_killers) = run();
        assert_eq!(first.score, second.score);
        assert_eq!(&first.pv[..first.length], &second.pv[..second.length]);
        assert_eq!(first_history, second_history);
        assert_eq!(first_killers, second_killers);
        assert!(first_history.iter().flatten().any(|value| *value != 0));
        // The default search never touches the dynamic-ordering tables.
        let mut plain = Search::new(b, w, true, 5, 4, 32768).unwrap();
        while plain.next_iteration().unwrap().is_some() {}
        assert!(plain.history.iter().flatten().all(|value| *value == 0));
        assert!(plain.killers.iter().flatten().all(|&k| k == u16::MAX));
    }
    #[test]
    fn tt_move_ordering_is_deterministic_and_locks_after_start() {
        let b = bits(&[112, 128, 99]);
        let w = bits(&[113, 97, 127]);
        let run = || {
            let mut search = Search::new(b, w, true, 5, 4, 32768).unwrap();
            search.set_tt_move(true).unwrap();
            let mut last = ResultLine::quiet(0);
            while let Some(iteration) = search.next_iteration().unwrap() {
                last = iteration.result;
            }
            (last, search.nodes, search.hits)
        };
        let (first, first_nodes, first_hits) = run();
        let (second, second_nodes, second_hits) = run();
        assert_eq!(first.score, second.score);
        assert_eq!(&first.pv[..first.length], &second.pv[..second.length]);
        assert_eq!(first_nodes, second_nodes);
        assert_eq!(first_hits, second_hits);
        let mut started = Search::new(b, w, true, 5, 4, 32768).unwrap();
        started.next_iteration().unwrap();
        assert!(started.set_tt_move(true).is_err());
    }
    #[test]
    fn fixed_width_configuration_is_validated_and_locked() {
        let mut search = Search::new(bits(&[112]), bits(&[113]), true, 2, 4, 32768).unwrap();
        assert!(search.set_candidate_width(0).is_err());
        assert!(search.set_candidate_width(226).is_err());
        search.set_candidate_width(8).unwrap();
        search.next_iteration().unwrap();
        assert!(search.set_candidate_width(12).is_err());
    }
    #[test]
    fn policy_plies_are_validated_locked_and_neutral_when_zero() {
        let mut search = Search::new(bits(&[112]), bits(&[113]), true, 4, 4, 32768).unwrap();
        assert!(search.set_policy_plies(226).is_err());
        search.set_policy_plies(3).unwrap();
        assert_eq!(search.policy_plies, 3);
        search.next_iteration().unwrap();
        assert!(search.set_policy_plies(2).is_err());
        let zero = crate::policy::from_weights(
            vec![0.0; crate::policy::POLICY_FEATURES],
            vec![0.0],
            vec![0.0],
            0.0,
        )
        .to_bytes();
        let black = bits(&[112, 113]);
        let white = bits(&[97, 98]);
        let mut plain = Search::new(black, white, true, 4, 4, 32768).unwrap();
        let mut scored = Search::new(black, white, true, 4, 4, 32768).unwrap();
        scored.set_policy(&zero, 1000.0).unwrap();
        scored.set_policy_plies(6).unwrap();
        while let Some(reference) = plain.next_iteration().unwrap() {
            let actual = scored.next_iteration().unwrap().unwrap();
            assert_eq!(reference.result.score, actual.result.score);
            assert_eq!(reference.result.pv[..reference.result.length], actual.result.pv[..actual.result.length]);
        }
    }
    #[test]
    fn mandatory_block_shortcut_restores_state_and_never_overrides_a_win() {
        for capacity in [0, 2, 32768] {
            let b = bits(&[107]);
            let w = bits(&[108, 109, 110, 111]);
            let mut search = Search::new(b, w, true, 3, 4, capacity).unwrap();
            let density = search.state.density.0;
            let hash = search.hasher;
            let result = search.fixed(3, true, -INFINITY, INFINITY).unwrap();
            assert_eq!(result.result.pv[0], 112);
            assert_eq!(search.state.black, b);
            assert_eq!(search.state.white, w);
            assert_eq!(search.state.density.0, density);
            assert_eq!(search.hasher, hash);
            assert_eq!(search.state.history_length(), 0);
            // Both players have exactly one winning square; take our win.
            let b = bits(&[0, 1, 2, 3, 107]);
            for perspective in [true, false] {
                let mut search = Search::new(b, w, perspective, 3, 4, capacity).unwrap();
                let result = search.fixed(3, true, -INFINITY, INFINITY).unwrap();
                assert_eq!(result.result.pv[0], if perspective { 4 } else { 112 });
                assert_eq!(result.result.score, WIN_SCORE - 1);
            }
        }
    }
    #[test]
    fn direct_search_selection_matches_legacy_for_all_pv_squares() {
        let mut boards = vec![
            ([0; 8], [0; 8]),
            (bits(&[107]), bits(&[108, 109, 110, 111])),
            (bits(&[0, 1, 2, 3, 107]), bits(&[108, 109, 110, 111])),
        ];
        let mut seed = 0x7182ac51u32;
        for count in [8, 24, 64, 120] {
            let mut b = [0; 8];
            let mut w = [0; 8];
            for i in 0..count {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                let p = (i * 73 + 31) % 225;
                (if seed & 1 == 0 { &mut b } else { &mut w })[p >> 5] |= 1 << (p & 31);
            }
            boards.push((b, w));
        }
        for (b, w) in boards {
            for color in [true, false] {
                let mut search = Search::new(b, w, color, 10, 4, 0).unwrap();
                let mut original = Candidates::default();
                crate::moves::generate_with_density(
                    &b,
                    &w,
                    color,
                    &search.state.winning,
                    &search.state.density.0,
                    &mut original,
                );
                for depth in [1, 4, 6, 10] {
                    for preferred in std::iter::once(None).chain((0..225).map(Some)) {
                        search.buffers[0].moves = original.moves;
                        search.buffers[0].len = original.len;
                        search.previous = preferred
                            .map_or_else(|| ResultLine::quiet(0), |p| ResultLine::single(0, p));
                        search.select(depth, 0);
                        let mut actual = Candidates::default();
                        generate_for_search(
                            &search.state,
                            color,
                            &mut actual,
                            SearchSelection {
                                depth,
                                width: None,
                                preferred,
                                forcing: [0; 8],
                eval_order: false,
                            },
                            None,
                            [0; 8],
                            None,
                        );
                        assert_eq!(
                            actual.as_slice(),
                            search.buffers[0].as_slice(),
                            "depth {depth}, PV {preferred:?}, color {color}"
                        );
                    }
                }
            }
        }
    }
    #[test]
    fn terminal_boards_and_invalid_configuration() {
        let b = bits(&[0, 1, 2, 3, 4]);
        let mut search = Search::new(b, [0; 8], true, 8, 4, 32768).unwrap();
        assert!(search.next_iteration().unwrap().is_none());
        assert_eq!(
            search
                .fixed(2, true, -INFINITY, INFINITY)
                .unwrap()
                .result
                .score,
            WIN_SCORE
        );
        assert!(Search::new([0; 8], [0; 8], true, 226, 4, 0).is_err());
        assert!(Search::new([0; 8], [0; 8], true, 8, 226, 0).is_err());
    }
    #[test]
    fn node_budget_publishes_the_best_completed_root_move_of_a_cut_iteration() {
        let b = bits(&[112, 128, 99]);
        let w = bits(&[113, 97, 127]);
        let mut reference = Search::new(b, w, true, 6, 4, 32768).unwrap();
        let mut depths = Vec::new();
        while let Some(iteration) = reference.next_iteration().unwrap() {
            depths.push(iteration);
        }
        assert!(depths.len() >= 4);
        // A budget inside the third iteration cuts it instead of overshooting:
        // the first iteration is exempt and the second one completes.
        let budget = depths[0].nodes + depths[1].nodes + depths[2].nodes / 2;
        let mut bounded = Search::new(b, w, true, 6, 4, 32768).unwrap();
        bounded.set_node_budget(budget).unwrap();
        let mut completed = Vec::new();
        while let Some(iteration) = bounded.next_iteration().unwrap() {
            completed.push(iteration);
        }
        // The aborted iteration is discarded, and never overshoots the budget.
        assert!(bounded.budget_exhausted());
        assert_eq!(bounded.total_nodes(), budget);
        assert!(completed.len() >= 2);
        // Two iterations complete, and at most one cut iteration is appended.
        for (bounded, reference) in completed[..2].iter().zip(&depths) {
            assert_eq!(bounded.depth, reference.depth);
            assert_eq!(bounded.result.score, reference.result.score);
            assert_eq!(bounded.nodes, reference.nodes);
            assert_eq!(
                &bounded.result.pv[..bounded.result.length],
                &reference.result.pv[..reference.result.length]
            );
        }
        assert!(completed.len() <= 3);
        // A cut iteration is published only when a completed root move already
        // beat the previous line, which is what makes its move safe to play.
        if let Some(cut) = completed.get(2) {
            assert_eq!(cut.depth, 3);
            assert!(cut.result.length > 0);
            assert!(cut.result.score > completed[1].result.score);
            assert!(cut.nodes > 0);
        }
    }
    #[test]
    fn cut_playback_is_off_by_default_and_locks_after_start() {
        let b = bits(&[112, 128, 99]);
        let w = bits(&[113, 97, 127]);
        let run = |play_cuts: Option<bool>| {
            let mut search = Search::new(b, w, true, 6, 4, 32768).unwrap();
            if let Some(enabled) = play_cuts {
                search.set_cut_playback(enabled).unwrap();
            }
            search.set_node_budget(4096).unwrap();
            let mut lines = Vec::new();
            while let Some(iteration) = search.next_iteration().unwrap() {
                lines.push(iteration);
            }
            (lines.len(), search.total_nodes(), search.budget_exhausted())
        };
        // The same work is done either way; only the published move differs.
        let (default_iterations, default_nodes, default_exhausted) = run(None);
        let (with_cut, cut_nodes, _) = run(Some(true));
        let (without_cut, plain_nodes, plain_exhausted) = run(Some(false));
        assert!(default_exhausted && plain_exhausted);
        assert_eq!(cut_nodes, plain_nodes);
        assert_eq!(default_nodes, plain_nodes);
        assert_eq!(default_iterations, without_cut);
        assert!(with_cut >= without_cut && with_cut <= without_cut + 1);
        let mut search = Search::new(b, w, true, 4, 4, 0).unwrap();
        search.next_iteration().unwrap();
        assert!(search.set_cut_playback(true).is_err());
    }
    #[test]
    fn deadline_cuts_a_search_and_still_returns_a_line() {
        let b = bits(&[112, 128, 99]);
        let w = bits(&[113, 97, 127]);
        let mut search = Search::new(b, w, true, 8, 4, 32768).unwrap();
        search.set_node_budget(0).unwrap();
        search
            .set_deadline(Some(
                std::time::Instant::now() + std::time::Duration::from_millis(2),
            ))
            .unwrap();
        let mut lines = Vec::new();
        while let Some(iteration) = search.next_iteration().unwrap() {
            lines.push(iteration);
        }
        // The exempt first iteration always completes, and the deadline ends the
        // search long before eight plies.
        assert!(!lines.is_empty());
        assert!(lines.last().unwrap().depth < 8);
        assert!(search.budget_exhausted());
        assert!(search.total_nodes() > 0);
        assert!(search.set_deadline(None).is_err());
    }
    #[test]
    fn node_budget_never_bounds_the_first_iteration() {
        let b = bits(&[112, 128, 99]);
        let w = bits(&[113, 97, 127]);
        let first = Search::new(b, w, true, 6, 4, 32768)
            .unwrap()
            .next_iteration()
            .unwrap()
            .unwrap();
        let mut bounded = Search::new(b, w, true, 6, 4, 32768).unwrap();
        bounded.set_node_budget(1).unwrap();
        let iteration = bounded.next_iteration().unwrap().unwrap();
        assert_eq!(iteration.depth, 1);
        assert_eq!(iteration.nodes, first.nodes);
        assert_eq!(iteration.result.score, first.result.score);
        assert_eq!(
            &iteration.result.pv[..iteration.result.length],
            &first.result.pv[..first.result.length]
        );
        assert_eq!(bounded.total_nodes(), first.nodes);
        assert!(bounded.next_iteration().unwrap().is_none());
        assert!(bounded.budget_exhausted());
    }
    #[test]
    fn node_budget_is_validated_locked_and_deterministic() {
        let b = bits(&[112, 128, 99]);
        let w = bits(&[113, 97, 127]);
        let unbounded = || {
            let mut search = Search::new(b, w, true, 6, 4, 32768).unwrap();
            let mut lines = Vec::new();
            while let Some(iteration) = search.next_iteration().unwrap() {
                lines.push(iteration.result);
            }
            lines
        };
        let mut search = Search::new(b, w, true, 6, 4, 32768).unwrap();
        assert!(search.set_node_budget(1_000_000_001).is_err());
        search.set_node_budget(0).unwrap();
        assert!(!search.budget_exhausted());
        search.next_iteration().unwrap();
        assert!(search.set_node_budget(4096).is_err());
        // A deterministic budget repeats exactly, and a generous budget is neutral.
        let run = |budget: u64| {
            let mut search = Search::new(b, w, true, 6, 4, 32768).unwrap();
            search.set_node_budget(budget).unwrap();
            let mut lines = Vec::new();
            while let Some(iteration) = search.next_iteration().unwrap() {
                lines.push(iteration.result);
            }
            (lines, search.total_nodes(), search.budget_exhausted())
        };
        let (first, nodes, exhausted) = run(4096);
        let (second, repeat_nodes, repeat_exhausted) = run(4096);
        assert_eq!(first.len(), second.len());
        assert_eq!(nodes, repeat_nodes);
        assert_eq!(exhausted, repeat_exhausted);
        for (first, second) in first.iter().zip(&second) {
            assert_eq!(first.score, second.score);
            assert_eq!(
                &first.pv[..first.length],
                &second.pv[..second.length]
            );
        }
        let (neutral, neutral_nodes, neutral_exhausted) = run(1_000_000);
        let reference = unbounded();
        assert_eq!(neutral.len(), reference.len());
        assert!(!neutral_exhausted);
        assert!(neutral_nodes > nodes);
        for (neutral, reference) in neutral.iter().zip(&reference) {
            assert_eq!(neutral.score, reference.score);
            assert_eq!(
                &neutral.pv[..neutral.length],
                &reference.pv[..reference.length]
            );
        }
    }
}

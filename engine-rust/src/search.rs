use crate::bitboards::{Bitboard, positions};
use crate::incremental::Evaluator;
use crate::moves::{Candidate, Candidates, generate_with_density};
use crate::rules::{self, BoardResult};
use crate::transposition::{Bound, CacheKey, Entry, Table, from_table, to_table};
use crate::zobrist::Hasher;

pub const WIN_SCORE: i32 = 1_000_000;
const INFINITY: i32 = 2_000_000;
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
/// Synchronous iterations. This is not yet a resumable node-budget search.
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
    hits: u64,
    cutoffs: u64,
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
            hits: 0,
            cutoffs: 0,
        })
    }
    pub fn next_iteration(&mut self) -> Result<Option<Iteration>, &'static str> {
        if self.done {
            return Ok(None);
        }
        // Diagnostic fixed searches may use the opposite side at the root.
        self.hasher = Hasher::new(&self.state.black, &self.state.white, self.perspective);
        let depth = self.next_depth;
        let hits = self.hits;
        let cutoffs = self.cutoffs;
        self.nodes = 0;
        let result = self.minimax(depth, -INFINITY, INFINITY, true, 0)?;
        if result.length == 0 {
            self.done = true;
            return Ok(None);
        }
        self.previous = result;
        self.next_depth += 1;
        self.done = depth >= self.max_depth || result.score.abs() >= WIN_SCORE - 225;
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
            return Ok(ResultLine::quiet(self.state.score()));
        }
        let p = positions(&threats.board, &[0; 8], false)
            .next()
            .expect("cached threat count");
        let token = self.state.make_leaf_move(p, own)?;
        self.hasher.toggle(p, own);
        self.nodes += 1;
        let child = self.horizon(!maximizing, ply + 1, remaining - 1);
        self.hasher.toggle(p, own);
        self.state.undo_move(token)?;
        Ok(ResultLine::prepend(p, child?))
    }
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
    fn minimax(
        &mut self,
        depth: usize,
        mut alpha: i32,
        mut beta: i32,
        maximizing: bool,
        ply: usize,
    ) -> Result<ResultLine, &'static str> {
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
        if depth == 0 {
            return if self.extension == 0 {
                Ok(ResultLine::quiet(self.state.score()))
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
        if let (Some(table), Some(key)) = (&self.table, &key)
            && let Some(entry) = table.get(key, &self.state.black, &self.state.white, to_move)
        {
            self.hits += 1;
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
            generate_with_density(
                &self.state.black,
                &self.state.white,
                to_move,
                &self.state.winning,
                &self.state.density.0,
                &mut self.buffers[ply],
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
        if !mandatory_block {
            self.select(depth, ply);
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
        for i in 0..self.buffers[ply].len {
            let candidate = self.buffers[ply].moves[i];
            let token = if depth == 1 {
                self.state.make_leaf_move(candidate.position, to_move)?
            } else {
                self.state.make_move(candidate.position, to_move)?
            };
            self.hasher.toggle(candidate.position, to_move);
            self.path[ply] = candidate.position as u16;
            let child = self.minimax(depth - 1, alpha, beta, !maximizing, ply + 1);
            self.hasher.toggle(candidate.position, to_move);
            self.state.undo_move(token)?;
            let child = child?;
            if (maximizing && child.score > best.score) || (!maximizing && child.score < best.score)
            {
                best = ResultLine::prepend(candidate.position, child);
            }
            if maximizing {
                alpha = alpha.max(child.score);
            } else {
                beta = beta.min(child.score);
            }
            if beta <= alpha {
                break;
            }
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
}

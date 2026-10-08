use crate::bitboards::{BOARD_CELLS, Bitboard, contains, positions};
use crate::lines::WinningCache;

const ROW_MASK: u16 = (1 << 15) - 1;
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Candidate {
    pub position: usize,
    pub priority: i32,
    /// Quantized policy ordering score; zero when no policy is active.
    pub policy: i32,
    /// Threat tier: 1 for a move creating an open three, else 0.
    pub tier: u8,
    /// Dynamic ordering score (main history + countermove + killer); zero when off.
    pub order: i32,
    /// Shallow evaluation of the position after this move, from the mover's view.
    pub eval_score: i32,
    /// None is reserved for empty-board opening candidates, matching JavaScript.
    pub tactical: Option<u8>,
    rank: u16,
}
impl Candidate {
    /// A unique mandatory reply needs no ranking metadata.
    pub fn mandatory_block(position: usize) -> Self {
        Self {
            position,
            tactical: Some(1),
            ..Self::default()
        }
    }
}
pub struct Candidates {
    pub moves: [Candidate; BOARD_CELLS],
    pub len: usize,
}
impl Default for Candidates {
    fn default() -> Self {
        Self {
            moves: [Candidate::default(); BOARD_CELLS],
            len: 0,
        }
    }
}
impl Candidates {
    pub fn as_slice(&self) -> &[Candidate] {
        &self.moves[..self.len]
    }
    pub fn packed(&self) -> Vec<i32> {
        let mut result = Vec::with_capacity(self.len * 3);
        for candidate in self.as_slice() {
            result.extend([
                candidate.position as i32,
                candidate.priority,
                candidate.tactical.map_or(-1, i32::from),
            ]);
        }
        result
    }
    fn push(&mut self, candidate: Candidate) {
        self.moves[self.len] = candidate;
        self.len += 1;
    }
}
/// Board context and model for scoring candidates with a policy re-ranker.
#[derive(Clone, Copy)]
pub struct PolicyScoring<'a> {
    pub policy: &'a crate::policy::Policy,
    pub black: &'a Bitboard,
    pub white: &'a Bitboard,
    pub scale: f32,
}
/// Dynamic move-ordering inputs for interior nodes: main history, countermove and
/// killer moves for the current ply. Everything reads as zero when off.
#[derive(Clone, Copy)]
pub struct MoveOrdering<'a> {
    /// Cutoff statistics for the side to move, indexed by square.
    pub history: &'a [i32; BOARD_CELLS],
    /// Best reply to the opponent's previous move, indexed by that square.
    pub counter: &'a [u16; BOARD_CELLS],
    /// Killers for the current ply; `u16::MAX` when unset.
    pub killers: [u16; 2],
    /// The opponent's previous move, or `u16::MAX` when there is none.
    pub previous: u16,
}
/// Killer and countermove bonuses; both exceed any clamped history value so a
/// proven reply reliably outranks accumulated history.
const ORDER_KILLER_BONUS: i32 = 1 << 15;
const ORDER_COUNTER_BONUS: i32 = 1 << 14;
fn ordering_score(ordering: Option<MoveOrdering>, position: usize) -> i32 {
    let Some(ordering) = ordering else {
        return 0;
    };
    let mut score = ordering.history[position];
    if ordering.previous != u16::MAX
        && ordering.counter[ordering.previous as usize] == position as u16
    {
        score += ORDER_COUNTER_BONUS;
    }
    if ordering.killers[0] == position as u16 {
        score += ORDER_KILLER_BONUS;
    } else if ordering.killers[1] == position as u16 {
        score += ORDER_KILLER_BONUS / 2;
    }
    score
}
fn columns(col: usize, radius: usize) -> u16 {
    let start = col.saturating_sub(radius);
    let end = (col + radius).min(14);
    ((1 << (end - start + 1)) - 1) << start
}
fn offset_order(dr: i32, dc: i32) -> u16 {
    const ORDER: [u16; 25] = [
        8, 9, 10, 11, 12, 13, 0, 1, 2, 14, 15, 3, 0, 4, 16, 17, 5, 6, 7, 18, 19, 20, 21, 22, 23,
    ];
    debug_assert!((-2..=2).contains(&dr) && (-2..=2).contains(&dc) && (dr != 0 || dc != 0));
    ORDER[((dr + 2) * 5 + dc + 2) as usize]
}
fn rank(row: usize, col: usize, source_row: usize, source_col: usize) -> u16 {
    ((source_row * 15 + source_col) * 24) as u16
        + offset_order(
            row as i32 - source_row as i32,
            col as i32 - source_col as i32,
        )
}

/// Shift-generated frontiers with identical JavaScript priorities and source ordering.
/// All candidate and scratch storage is fixed-size; caller can reuse a supplied buffer.
pub fn generate_into(
    black: &Bitboard,
    white: &Bitboard,
    player_black: bool,
    winning: &WinningCache,
    result: &mut Candidates,
) {
    let density = crate::neighborhood::Density::new(black, white);
    generate_with_density(black, white, player_black, winning, &density.0, result);
}

pub fn generate_with_density(
    black: &Bitboard,
    white: &Bitboard,
    player_black: bool,
    winning: &WinningCache,
    density: &[u8; 225],
    result: &mut Candidates,
) {
    let mut occupied = [0u16; 15];
    for p in positions(black, white, false) {
        occupied[p / 15] |= 1 << (p % 15);
    }
    generate_ranked(
        occupied,
        black,
        white,
        player_black,
        winning,
        density,
        result,
        None,
        None,
        [0; 8],
        None,
    );
}

#[derive(Clone, Copy)]
pub struct SearchSelection {
    pub depth: usize,
    pub width: Option<usize>,
    pub preferred: Option<usize>,
    pub forcing: Bitboard,
    /// Order quiet candidates by the shallow evaluation of the resulting position.
    pub eval_order: bool,
}
pub fn generate_for_search(
    state: &crate::incremental::Evaluator,
    player_black: bool,
    result: &mut Candidates,
    selection: SearchSelection,
    scoring: Option<PolicyScoring>,
    three: Bitboard,
    ordering: Option<MoveOrdering>,
) {
    generate_ranked(
        state.lines.occupied_rows(),
        &state.black,
        &state.white,
        player_black,
        &state.winning,
        &state.density.0,
        result,
        Some(selection),
        scoring,
        three,
        ordering,
    );
}
pub fn generate_from_state(
    state: &crate::incremental::Evaluator,
    player_black: bool,
    result: &mut Candidates,
) {
    generate_ranked(
        state.lines.occupied_rows(),
        &state.black,
        &state.white,
        player_black,
        &state.winning,
        &state.density.0,
        result,
        None,
        None,
        [0; 8],
        None,
    );
}
fn generate_ranked(
    occupied: [u16; 15],
    black: &Bitboard,
    white: &Bitboard,
    player_black: bool,
    winning: &WinningCache,
    density: &[u8; 225],
    result: &mut Candidates,
    selection: Option<SearchSelection>,
    scoring: Option<PolicyScoring>,
    three: Bitboard,
    ordering: Option<MoveOrdering>,
) {
    result.len = 0;
    let eval_order = selection.is_some_and(|s| s.eval_order);
    // Shallow evaluation of the position after playing `position`, from the mover's
    // view. Only computed when the caller asks for evaluation ordering.
    let eval_score = |position: usize| -> i32 {
        if !eval_order {
            return 0;
        }
        let mut own = if player_black { *black } else { *white };
        own[position >> 5] |= 1 << (position & 31);
        let (next_black, next_white) = if player_black {
            (own, *white)
        } else {
            (*black, own)
        };
        crate::evaluation::evaluate(&next_black, &next_white, player_black)
    };
    let stone_count: usize = occupied.iter().map(|row| row.count_ones() as usize).sum();
    let policy_score = |position: usize, priority: i32, tactical: u8| match scoring {
        Some(scoring) => {
            let features = crate::policy::features(
                scoring.black,
                scoring.white,
                position,
                player_black,
                priority,
                tactical,
                stone_count,
            );
            (scoring.policy.score(&features).unwrap_or(0.0) * scoring.scale).round() as i32
        }
        None => 0,
    };
    if stone_count == 0 {
        for (row, col, priority) in [
            (7, 7, 1000),
            (6, 6, 900),
            (6, 7, 950),
            (6, 8, 900),
            (7, 6, 950),
            (7, 8, 950),
            (8, 6, 900),
            (8, 7, 950),
            (8, 8, 900),
        ] {
            result.push(Candidate {
                position: row * 15 + col,
                priority,
                policy: policy_score(row * 15 + col, priority, 0),
                tier: 0,
                order: ordering_score(ordering, row * 15 + col),
                eval_score: 0,
                tactical: None,
                rank: result.len as u16,
            });
        }
        finish(result, 0, 0, 0, selection);
        return;
    }
    let mut adjacent_expansion = [0u16; 15];
    let mut extended_expansion = [0u16; 15];
    let mut dense = [0u16; 15];
    for row in 0..15 {
        let s = occupied[row];
        adjacent_expansion[row] = (s | (s << 1) | (s >> 1)) & ROW_MASK;
        let mut sources = s;
        while sources != 0 {
            let col = sources.trailing_zeros() as usize;
            if density[row * 15 + col] >= 3 {
                dense[row] |= 1 << col;
            }
            sources &= sources - 1;
        }
        let d = dense[row] as u32;
        extended_expansion[row] =
            ((d | (d << 1) | (d >> 1) | (d << 2) | (d >> 2)) & ROW_MASK as u32) as u16;
    }
    let (own_wins, enemy_wins) = if player_black {
        (&winning.black.board, &winning.white.board)
    } else {
        (&winning.white.board, &winning.black.board)
    };
    let mut tactical_count = 0;
    let mut win_count = 0;
    for row in 0usize..15 {
        let adjacent = adjacent_expansion[row.saturating_sub(1)..=(row + 1).min(14)]
            .iter()
            .fold(0, |a, b| a | b);
        let extended = extended_expansion[row.saturating_sub(2)..=(row + 2).min(14)]
            .iter()
            .fold(0, |a, b| a | b);
        let mut frontier = (adjacent | extended) & !occupied[row] & ROW_MASK;
        while frontier != 0 {
            let col = frontier.trailing_zeros() as usize;
            let bit = 1 << col;
            let p = row * 15 + col;
            let center = 14 - (row as i32 - 7).abs() - (col as i32 - 7).abs();
            let mut first_rank = None;
            let priority;
            if adjacent & bit != 0 {
                priority = 100 + i32::from(density[p]) * 20 + center;
                let radius = if extended & bit != 0 { 2 } else { 1 };
                for r in row.saturating_sub(radius)..=(row + radius).min(14) {
                    let near_row = row.abs_diff(r) <= 1;
                    let near = if near_row {
                        occupied[r] & columns(col, 1)
                    } else {
                        0
                    };
                    let mut distant = dense[r] & columns(col, 2);
                    if near_row {
                        distant &= !columns(col, 1);
                    }
                    let sources = near | distant;
                    if sources != 0 {
                        first_rank = Some(rank(row, col, r, sources.trailing_zeros() as usize));
                        break;
                    }
                }
            } else {
                let mut max_density = 0;
                for r in row.saturating_sub(2)..=(row + 2).min(14) {
                    let mut sources = dense[r] & columns(col, 2);
                    if first_rank.is_none() && sources != 0 {
                        first_rank = Some(rank(row, col, r, sources.trailing_zeros() as usize));
                    }
                    while sources != 0 {
                        let c = sources.trailing_zeros() as usize;
                        max_density = max_density.max(density[r * 15 + c]);
                        sources &= sources - 1;
                    }
                }
                priority = 30 + i32::from(max_density) * 5 + center;
            }
            let tactical = if contains(own_wins, p) {
                2
            } else if contains(enemy_wins, p) {
                1
            } else {
                0
            };
            if tactical == 2 {
                win_count += 1;
            }
            if tactical != 0 {
                tactical_count += 1;
            }
            result.push(Candidate {
                position: p,
                priority,
                policy: policy_score(p, priority, tactical),
                tier: u8::from(tactical == 0 && contains(&three, p)),
                order: ordering_score(ordering, p),
                eval_score: if tactical == 0 { eval_score(p) } else { 0 },
                tactical: Some(tactical),
                rank: first_rank.expect("frontier has a qualifying source"),
            });
            frontier &= frontier - 1;
        }
    }
    finish(result, stone_count, tactical_count, win_count, selection);
}
fn compare(a: &Candidate, b: &Candidate) -> std::cmp::Ordering {
    b.tactical
        .cmp(&a.tactical)
        .then(b.tier.cmp(&a.tier))
        .then(b.policy.cmp(&a.policy))
        .then(b.eval_score.cmp(&a.eval_score))
        .then(b.order.cmp(&a.order))
        .then(b.priority.cmp(&a.priority))
        .then(a.rank.cmp(&b.rank))
}
fn compare_with_forcing(a: &Candidate, b: &Candidate, forcing: &Bitboard) -> std::cmp::Ordering {
    let forced = |m: &Candidate| m.tactical == Some(0) && contains(forcing, m.position);
    b.tactical
        .cmp(&a.tactical)
        .then_with(|| forced(b).cmp(&forced(a)))
        .then_with(|| compare(a, b))
}
fn sort_prefix(result: &mut Candidates, retained: usize, forcing: &Bitboard) {
    let order = |a: &Candidate, b: &Candidate| compare_with_forcing(a, b, forcing);
    if result.len > retained * 2 && retained > 0 {
        result.moves[..result.len].select_nth_unstable_by(retained, order);
        result.moves[..retained].sort_unstable_by(order);
    } else {
        result.moves[..result.len].sort_unstable_by(order);
    }
    result.len = retained;
}
fn finish(
    result: &mut Candidates,
    stone_count: usize,
    tactical_count: usize,
    win_count: usize,
    selection: Option<SearchSelection>,
) {
    let forcing = selection.map_or([0; 8], |s| s.forcing);
    let protected_count = result
        .as_slice()
        .iter()
        .filter(|m| m.tactical.is_some_and(|t| t > 0) || contains(&forcing, m.position))
        .count();
    let eligible = result
        .len
        .min((if stone_count < 10 { 30 } else { 50 }).max(protected_count));
    let Some(selection) = selection else {
        sort_prefix(result, eligible, &forcing);
        return;
    };
    if win_count == 0 && tactical_count == 1 {
        let block = *result
            .as_slice()
            .iter()
            .find(|m| m.tactical == Some(1))
            .expect("single block");
        result.moves[0] = block;
        result.len = 1;
        return;
    }
    let eligible = if win_count > 0 { win_count } else { eligible };
    let tactics = if win_count > 0 {
        win_count
    } else {
        protected_count
    };
    let retained = eligible.min(
        selection
            .width
            .unwrap_or_else(|| 20usize.saturating_sub(selection.depth * 2).max(8))
            .max(tactics),
    );
    let preferred = selection
        .preferred
        .and_then(|p| result.as_slice().iter().find(|m| m.position == p).copied())
        .and_then(|candidate| {
            if win_count > 0 && candidate.tactical != Some(2) {
                return None;
            }
            // Preserve eligibility under the old 30/50 cap before PV promotion.
            let rank = result
                .as_slice()
                .iter()
                .filter(|m| compare_with_forcing(m, &candidate, &forcing).is_lt())
                .count();
            (rank < eligible).then_some((candidate, rank))
        });
    if let Some((candidate, rank)) = preferred {
        if rank >= retained {
            // Remove only a quiet slot; otherwise add room for the PV.
            sort_prefix(
                result,
                if retained > tactics {
                    retained - 1
                } else {
                    retained
                },
                &forcing,
            );
            result.moves[..=result.len].rotate_right(1);
            result.moves[0] = candidate;
            result.len += 1;
        } else {
            sort_prefix(result, retained, &forcing);
            let index = result
                .as_slice()
                .iter()
                .position(|m| m.position == candidate.position)
                .expect("retained PV");
            result.moves[..=index].rotate_right(1);
        }
    } else {
        sort_prefix(result, retained, &forcing);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lines::LineBoards;
    #[test]
    fn fixed_width_is_independent_of_remaining_depth() {
        let mut black = [0; 8];
        black[112 >> 5] |= 1 << (112 & 31);
        black[48 >> 5] |= 1 << (48 & 31);
        let mut white = [0; 8];
        white[160 >> 5] |= 1 << (160 & 31);
        let state = crate::incremental::Evaluator::new(black, white, true);
        for width in [1, 8, 12, 18] {
            let mut reference = Candidates::default();
            generate_for_search(
                &state,
                true,
                &mut reference,
                SearchSelection {
                    depth: 1,
                    width: Some(width),
                    preferred: None,
                    forcing: [0; 8],
                eval_order: false,
                },
                None,
                [0; 8],
                None,
            );
            assert_eq!(reference.len, width);
            for depth in 2..=10 {
                let mut actual = Candidates::default();
                generate_for_search(
                    &state,
                    true,
                    &mut actual,
                    SearchSelection {
                        depth,
                        width: Some(width),
                        preferred: None,
                        forcing: [0; 8],
                eval_order: false,
                    },
                    None,
                    [0; 8],
                    None,
                );
                assert_eq!(actual.as_slice(), reference.as_slice());
            }
        }
    }
    #[test]
    fn generated_four_attacks_survive_both_caps_for_both_colors() {
        let mut own = [0; 8];
        for row in (0..15).step_by(2) {
            for col in [1, 2, 3, 6, 7, 8, 11, 12, 13] {
                let p = row * 15 + col;
                own[p >> 5] |= 1 << (p & 31);
            }
        }
        for color in [true, false] {
            let (black, white) = if color { (own, [0; 8]) } else { ([0; 8], own) };
            let state = crate::incremental::Evaluator::new(black, white, color);
            assert_eq!(state.winning.black.count + state.winning.white.count, 0);
            let forcing = crate::vcf::four_moves(&state.lines, color);
            assert!(positions(&forcing, &[0; 8], false).count() > 50);
            let mut selected = Candidates::default();
            generate_for_search(
                &state,
                color,
                &mut selected,
                SearchSelection {
                    depth: 10,
                    width: Some(1),
                    preferred: None,
                    forcing,
                    eval_order: false,
                },
                None,
                [0; 8],
                None,
            );
            for p in positions(&forcing, &[0; 8], false) {
                assert!(selected.as_slice().iter().any(|m| m.position == p));
            }
        }
    }
    #[test]
    fn forcing_cap_and_pv_promotion_keep_every_protected_move() {
        for count in [12, 60] {
            let mut candidates = Candidates::default();
            let mut forcing = [0; 8];
            for position in 0..80 {
                candidates.push(Candidate {
                    position,
                    priority: position as i32,
                    policy: 0,
                    tier: 0,
                    order: 0,
                    eval_score: 0,
                    tactical: Some(0),
                    rank: position as u16,
                });
                if position < count {
                    forcing[position >> 5] |= 1 << (position & 31);
                }
            }
            finish(
                &mut candidates,
                16,
                0,
                0,
                Some(SearchSelection {
                    depth: 10,
                    width: Some(1),
                    preferred: Some(79),
                    forcing,
                    eval_order: false,
                }),
            );
            for p in 0..count {
                assert!(candidates.as_slice().iter().any(|m| m.position == p));
            }
            if count == 12 {
                assert_eq!(candidates.len, 13);
                assert_eq!(candidates.moves[0].position, 79);
            } else {
                assert_eq!(candidates.len, 60);
            }
        }
    }
    #[test]
    fn opening_and_full_board() {
        let mut out = Candidates::default();
        let empty = [0; 8];
        let cache = WinningCache::new(&LineBoards::new(&empty, &empty));
        generate_into(&empty, &empty, true, &cache, &mut out);
        assert_eq!(
            out.as_slice()
                .iter()
                .map(|m| m.position)
                .collect::<Vec<_>>(),
            vec![112, 97, 111, 113, 127, 96, 98, 126, 128]
        );
        assert!(out.as_slice().iter().all(|m| m.tactical.is_none()));
        generate_into(&[u32::MAX; 8], &empty, true, &cache, &mut out);
        assert_eq!(out.len, 0);
    }
    #[test]
    fn immediate_win_precedes_block() {
        let mut b = [0; 8];
        let mut w = [0; 8];
        for p in [108, 109, 110, 111] {
            b[p >> 5] |= 1 << (p & 31);
        }
        for p in [153, 154, 155, 156] {
            w[p >> 5] |= 1 << (p & 31);
        }
        let cache = WinningCache::new(&LineBoards::new(&b, &w));
        let mut out = Candidates::default();
        generate_into(&b, &w, true, &cache, &mut out);
        assert_eq!(out.moves[0].tactical, Some(2));
        assert!(out.as_slice().iter().any(|m| m.position == 112));
        assert!(
            out.as_slice()
                .iter()
                .any(|m| m.position == 157 && m.tactical == Some(1))
        );
    }
    #[test]
    fn policy_reorders_quiet_candidates_and_zero_policy_is_neutral() {
        let mut black = [0; 8];
        let mut white = [0; 8];
        black[112 >> 5] |= 1 << (112 & 31);
        black[113 >> 5] |= 1 << (113 & 31);
        white[97 >> 5] |= 1 << (97 & 31);
        white[98 >> 5] |= 1 << (98 & 31);
        let state = crate::incremental::Evaluator::new(black, white, true);
        let selection = SearchSelection {
            depth: 4,
            width: Some(20),
            preferred: None,
            forcing: [0; 8],
                eval_order: false,
        };
        let mut reference = Candidates::default();
        generate_for_search(&state, true, &mut reference, selection, None, [0; 8], None);
        assert!(reference.len >= 8);
        let positions = |candidates: &Candidates| {
            candidates
                .as_slice()
                .iter()
                .map(|m| m.position)
                .collect::<Vec<_>>()
        };
        let zero = crate::policy::from_weights(
            vec![0.0; crate::policy::POLICY_FEATURES * 1],
            vec![0.0],
            vec![0.0],
            0.0,
        );
        let mut neutral = Candidates::default();
        generate_for_search(
            &state,
            true,
            &mut neutral,
            selection,
            Some(PolicyScoring {
                policy: &zero,
                black: &state.black,
                white: &state.white,
                scale: 1000.0,
            }),
            [0; 8],
            None,
        );
        assert_eq!(neutral.as_slice(), reference.as_slice());
        // bias - (priority feature) ranks low-priority moves first, inverting the order.
        let mut input = vec![0.0; crate::policy::POLICY_FEATURES];
        input[0] = -1000.0;
        let reverse = crate::policy::from_weights(input, vec![1000.0], vec![1.0], 0.0);
        let mut reordered = Candidates::default();
        generate_for_search(
            &state,
            true,
            &mut reordered,
            selection,
            Some(PolicyScoring {
                policy: &reverse,
                black: &state.black,
                white: &state.white,
                scale: 1000.0,
            }),
            [0; 8],
            None,
        );
        assert_eq!(reordered.len, reference.len);
        assert_ne!(positions(&reordered), positions(&reference));
    }

    #[test]
    fn three_tier_promotes_open_three_moves_ahead_of_quiet_moves() {
        let mut black = [0; 8];
        black[112 >> 5] |= 1 << (112 & 31);
        black[48 >> 5] |= 1 << (48 & 31);
        let mut white = [0; 8];
        white[160 >> 5] |= 1 << (160 & 31);
        let state = crate::incremental::Evaluator::new(black, white, true);
        let selection = SearchSelection {
            depth: 4,
            width: Some(8),
            preferred: None,
            forcing: [0; 8],
                eval_order: false,
        };
        let mut plain = Candidates::default();
        generate_for_search(&state, true, &mut plain, selection, None, [0; 8], None);
        assert!(plain.as_slice().iter().all(|m| m.tactical == Some(0)));
        let target = plain
            .as_slice()
            .last()
            .expect("frontier is non-empty")
            .position;
        let mut three = [0; 8];
        three[target >> 5] |= 1 << (target & 31);
        let mut tiered = Candidates::default();
        generate_for_search(&state, true, &mut tiered, selection, None, three, None);
        assert_eq!(
            tiered.as_slice().first().expect("frontier is non-empty").position,
            target
        );
        assert_eq!(tiered.as_slice().len(), plain.as_slice().len());
    }

    #[test]
    fn dynamic_ordering_promotes_history_killer_and_countermove() {
        let mut black = [0; 8];
        black[112 >> 5] |= 1 << (112 & 31);
        black[48 >> 5] |= 1 << (48 & 31);
        let mut white = [0; 8];
        white[160 >> 5] |= 1 << (160 & 31);
        let state = crate::incremental::Evaluator::new(black, white, true);
        let selection = SearchSelection {
            depth: 4,
            width: Some(8),
            preferred: None,
            forcing: [0; 8],
                eval_order: false,
        };
        let mut plain = Candidates::default();
        generate_for_search(&state, true, &mut plain, selection, None, [0; 8], None);
        assert!(plain.as_slice().iter().all(|m| m.tactical == Some(0)));
        let target = plain
            .as_slice()
            .last()
            .expect("frontier is non-empty")
            .position;
        let empty = [0i32; crate::bitboards::BOARD_CELLS];
        let unset = [u16::MAX; crate::bitboards::BOARD_CELLS];
        fn first(state: &crate::incremental::Evaluator, ordering: MoveOrdering) -> usize {
            let selection = SearchSelection {
                depth: 4,
                width: Some(8),
                preferred: None,
                forcing: [0; 8],
                eval_order: false,
            };
            let mut result = Candidates::default();
            generate_for_search(state, true, &mut result, selection, None, [0; 8], Some(ordering));
            result.as_slice().first().expect("frontier is non-empty").position
        }
        let mut history = empty;
        history[target] = 4096;
        assert_eq!(
            first(
                &state,
                MoveOrdering {
                    history: &history,
                    counter: &unset,
                    killers: [u16::MAX; 2],
                    previous: u16::MAX,
                }
            ),
            target
        );
        assert_eq!(
            first(
                &state,
                MoveOrdering {
                    history: &empty,
                    counter: &unset,
                    killers: [target as u16, u16::MAX],
                    previous: u16::MAX,
                }
            ),
            target
        );
        let mut counter = unset;
        counter[7] = target as u16;
        assert_eq!(
            first(
                &state,
                MoveOrdering {
                    history: &empty,
                    counter: &counter,
                    killers: [u16::MAX; 2],
                    previous: 7,
                }
            ),
            target
        );
    }
}

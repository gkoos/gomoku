//! Threat-space move generation for Victory-by-Continuous-Threat (VCT) search.
//!
//! The existing continuous-four solver ([`crate::vcf`]) only knows moves that
//! directly complete a four. A full VCT search additionally needs moves that
//! create an *open three* (which can be converted into a four next turn) and
//! moves that create an *unanswerable* double threat (four-three or
//! double-three). This module supplies those generators without changing the
//! solver semantics; the caller decides how to budget and interpret them.

use crate::bitboards::{Bitboard, contains, positions};
use crate::lines::{LineBoards, WinningCache, geometry};

/// Does placing a stone at `bit` create a clean open three through that square?
///
/// A clean open three is three *consecutive* friendly stones with both ends
/// empty. Broken/jump threes such as `_XX_X_` are excluded because a double
/// broken three is not a guaranteed forced win. A six-cell span whose four-cell
/// interior holds two friendly stones and no blockers, with both ends empty,
/// becomes a clean open three once the third stone makes the trio consecutive.
fn open_three_at(own: u16, enemy: u16, length: usize, bit: u16) -> bool {
    if length < 6 || bit.count_ones() != 1 {
        return false;
    }
    for start in 0..=length - 6 {
        let interior = 0b1111u16 << (start + 1);
        if interior & bit == 0 {
            continue;
        }
        if interior & enemy != 0 {
            continue;
        }
        let ends = (1u16 << start) | (1u16 << (start + 5));
        if (own | enemy) & ends != 0 {
            continue;
        }
        let stones = (own | bit) & interior;
        if stones == 0b0111u16 << (start + 1) || stones == 0b1110u16 << (start + 1) {
            return true;
        }
    }
    false
}

/// Does `p` (already placed for `color`) participate in a clean consecutive open
/// three in `direction`? Broken/jump threes are excluded.
fn clean_three_through(lines: &LineBoards, color: bool, p: usize, direction: usize) -> bool {
    let member = geometry().memberships[p][direction];
    let length = geometry().lengths[member.line];
    if length < 6 {
        return false;
    }
    let (own, enemy) = if color {
        (lines.black[member.line], lines.white[member.line])
    } else {
        (lines.white[member.line], lines.black[member.line])
    };
    let bit = member.bit;
    for start in 0..=length - 6 {
        let interior = 0b1111u16 << (start + 1);
        if interior & bit == 0 {
            continue;
        }
        if interior & enemy != 0 {
            continue;
        }
        let ends = (1u16 << start) | (1u16 << (start + 5));
        if (own | enemy) & ends != 0 {
            continue;
        }
        let stones = own & interior;
        if stones == 0b0111u16 << (start + 1) || stones == 0b1110u16 << (start + 1) {
            return true;
        }
    }
    false
}

/// Every move that creates an open three for `color`.
pub fn three_moves(lines: &LineBoards, color: bool) -> Bitboard {
    let (own, enemy) = if color {
        (&lines.black, &lines.white)
    } else {
        (&lines.white, &lines.black)
    };
    let mut board = [0; 8];
    for line in 0..88 {
        let length = geometry().lengths[line];
        if length < 6 {
            continue;
        }
        let (o, e) = (own[line], enemy[line]);
        let mut mask = !(o | e) & ((1u16 << length) - 1);
        while mask != 0 {
            let bit = mask & mask.wrapping_neg();
            if open_three_at(o, e, length, bit) {
                let p = geometry().cells[line][bit.trailing_zeros() as usize];
                board[p >> 5] |= 1 << (p & 31);
            }
            mask &= mask - 1;
        }
    }
    board
}

/// Every move that creates an unanswerable threat for `color`:
/// two or more winning squares (open four / double four), a four plus an open
/// three on another line (four-three), or two open threes on distinct lines
/// (double-three). The defender cannot stop all of these on a single reply.
pub fn double_threat_moves(lines: &mut LineBoards, color: bool) -> Bitboard {
    let fours = crate::vcf::four_moves(lines, color);
    let threes = three_moves(lines, color);
    let mut candidates = [0; 8];
    for i in 0..8 {
        candidates[i] = fours[i] | threes[i];
    }

    let mut result = [0; 8];
    let mut winning = crate::lines::WinningCache::new(lines);
    for p in positions(&candidates, &[0; 8], false) {
        lines.update(p, color, true);
        let undo = winning.refresh(lines, p);
        let own = if color {
            &winning.black
        } else {
            &winning.white
        };
        let win_count = own.count;
        let mut three_dirs = 0u32;
        for direction in 0..4 {
            if clean_three_through(lines, color, p, direction) {
                three_dirs += 1;
            }
        }
        if win_count >= 2 || (win_count >= 1 && three_dirs >= 1) || three_dirs >= 2 {
            result[p >> 5] |= 1 << (p & 31);
        }
        winning.restore(undo);
        lines.update(p, color, false);
    }
    result
}

/// Cheap eligibility test before probing the VCT horizon cache. A position can
/// start a threat sequence when it holds a four-window or any open-three move.
pub fn can_start(lines: &LineBoards, color: bool) -> bool {
    if crate::vcf::can_start(lines, color) {
        return true;
    }
    positions(&three_moves(lines, color), &[0; 8], false)
        .next()
        .is_some()
}

/// A continuous-threat proof. As with [`crate::vcf`], an unknown result never
/// means a forced loss: the solver only returns a verified win line, or
/// [`Outcome::line`] `None` when it is out of budget or plies.
pub struct Outcome {
    pub line: Option<Vec<u16>>,
    pub plies: usize,
    pub nodes: usize,
    pub exhausted: bool,
}

pub const MAX_PLIES: usize = 15;
pub const NODE_BUDGET: usize = 2048;
pub const HORIZON_PLIES: usize = 7;
pub const HORIZON_NODES: usize = 32;

struct Solver {
    attacker: bool,
    budget: usize,
    nodes: usize,
    exhausted: bool,
}

impl Solver {
    fn tick(&mut self) -> bool {
        if self.nodes >= self.budget {
            self.exhausted = true;
            return false;
        }
        self.nodes += 1;
        true
    }

    fn attack(
        &mut self,
        lines: &mut LineBoards,
        winning: &mut WinningCache,
        remaining: usize,
    ) -> Option<(Vec<u16>, usize)> {
        if remaining == 0 || !self.tick() {
            return None;
        }
        {
            let own = if self.attacker {
                &winning.black
            } else {
                &winning.white
            };
            if let Some(p) = positions(&own.board, &[0; 8], false).next() {
                return Some((vec![p as u16], 1));
            }
        }
        let enemy_count = if self.attacker {
            winning.white.count
        } else {
            winning.black.count
        };
        if enemy_count >= 2 {
            return None;
        }
        let mandatory = if enemy_count == 1 {
            let enemy = if self.attacker {
                &winning.white
            } else {
                &winning.black
            };
            positions(&enemy.board, &[0; 8], false).next()
        } else {
            None
        };

        // Four-creating moves force a reply, so try them first: this reaches the
        // forcing branch before the many quiet three-extensions consume the node
        // budget. Three-creating moves only matter for double-three detection.
        let fours = crate::vcf::four_moves(lines, self.attacker);
        let threes = three_moves(lines, self.attacker);
        // Prefer the fastest wins: scan for a double four (three plies) before
        // the deeper four-three and broken-four continuations, so a quick fork
        // is never outranked by a slower threat chain.
        for p in positions(&fours, &[0; 8], false) {
            if mandatory.is_some_and(|block| block != p) {
                continue;
            }
            if !self.tick() {
                return None;
            }
            lines.update(p, self.attacker, true);
            let undo = winning.refresh(lines, p);
            let win_count = if self.attacker {
                winning.black.count
            } else {
                winning.white.count
            };
            let fast = if win_count >= 2 && remaining >= 3 {
                let own = if self.attacker {
                    &winning.black
                } else {
                    &winning.white
                };
                let mut squares = positions(&own.board, &[0; 8], false);
                Some((
                    vec![
                        p as u16,
                        squares.next().expect("first winning square") as u16,
                        squares.next().expect("second winning square") as u16,
                    ],
                    3,
                ))
            } else {
                None
            };
            lines.update(p, self.attacker, false);
            winning.restore(undo);
            if fast.is_some() {
                return fast;
            }
        }
        for p in positions(&fours, &[0; 8], false) {
            if mandatory.is_some_and(|block| block != p) {
                continue;
            }
            if let Some(result) = self.consider(lines, winning, p, remaining) {
                return Some(result);
            }
            if self.exhausted {
                return None;
            }
        }
        // A double-three needs five plies, so skip the quiet three-extensions
        // once the remaining budget cannot pay for them.
        if remaining >= 5 {
            for p in positions(&threes, &[0; 8], false) {
                if contains(&fours, p) || mandatory.is_some_and(|block| block != p) {
                    continue;
                }
                if let Some(result) = self.consider(lines, winning, p, remaining) {
                    return Some(result);
                }
                if self.exhausted {
                    return None;
                }
            }
        }
        None
    }

    /// Play one candidate and return a win line with its distance, if any.
    fn consider(
        &mut self,
        lines: &mut LineBoards,
        winning: &mut WinningCache,
        p: usize,
        remaining: usize,
    ) -> Option<(Vec<u16>, usize)> {
        if !self.tick() {
            return None;
        }
        lines.update(p, self.attacker, true);
        let undo = winning.refresh(lines, p);
        let win_count = if self.attacker {
            winning.black.count
        } else {
            winning.white.count
        };
        let mut three_dirs = 0u32;
        for direction in 0..4 {
            if clean_three_through(lines, self.attacker, p, direction) {
                three_dirs += 1;
            }
        }
        let mut result = None;
        if win_count >= 2 && remaining >= 3 {
            // Open four / double four: the defender blocks one winning square,
            // the attacker takes the other for five (three plies).
            let own = if self.attacker {
                &winning.black
            } else {
                &winning.white
            };
            let mut squares = positions(&own.board, &[0; 8], false);
            result = Some((
                vec![
                    p as u16,
                    squares.next().expect("first winning square") as u16,
                    squares.next().expect("second winning square") as u16,
                ],
                3,
            ));
        } else if win_count == 0 && three_dirs >= 2 && remaining >= 5 {
            // A double three wins only if the defender has no four-threat to
            // force a reply first; otherwise their counter disrupts the chain.
            let defender_fours = crate::vcf::four_moves(lines, !self.attacker);
            if positions(&defender_fours, &[0; 8], false).next().is_none() {
                result = Some((vec![p as u16], 5));
            }
        } else {
            let cur_enemy = if self.attacker {
                winning.white.count
            } else {
                winning.black.count
            };
            if cur_enemy == 0 && win_count == 1 && remaining >= 3 {
                let block = {
                    let own = if self.attacker {
                        &winning.black
                    } else {
                        &winning.white
                    };
                    positions(&own.board, &[0; 8], false)
                        .next()
                        .expect("cached single winning square")
                };
                lines.update(block, !self.attacker, true);
                let reply_undo = winning.refresh(lines, block);
                if let Some((mut tail, tail_plies)) =
                    self.attack(lines, winning, remaining - 2)
                {
                    tail.insert(0, block as u16);
                    tail.insert(0, p as u16);
                    result = Some((tail, tail_plies + 2));
                }
                lines.update(block, !self.attacker, false);
                winning.restore(reply_undo);
            }
        }
        lines.update(p, self.attacker, false);
        winning.restore(undo);
        result
    }
}

pub fn solve(
    lines: &mut LineBoards,
    winning: &mut WinningCache,
    attacker: bool,
    max_plies: usize,
    budget: usize,
) -> Outcome {
    let mut solver = Solver {
        attacker,
        budget,
        nodes: 0,
        exhausted: false,
    };
    let (line, plies) = match solver.attack(lines, winning, max_plies) {
        Some((line, plies)) => (Some(line), plies),
        None => (None, 0),
    };
    Outcome {
        line,
        plies,
        nodes: solver.nodes,
        exhausted: solver.exhausted,
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

    fn set_positions(board: &Bitboard) -> Vec<usize> {
        positions(board, &[0; 8], false).collect()
    }

    #[test]
    fn three_moves_cover_the_ends_of_a_clean_three() {
        // Black holds two adjacent stones on row 7 (cols 7 and 8); each end
        // completes a clean consecutive three, and broken extensions are excluded.
        let black = bits(&[112, 113]);
        let lines = LineBoards::new(&black, &[0; 8]);
        assert_eq!(set_positions(&three_moves(&lines, true)), vec![111, 114]);
        // No white stones, so white has no three-creating moves.
        assert_eq!(
            set_positions(&three_moves(&lines, false)),
            Vec::<usize>::new()
        );
    }

    #[test]
    fn double_three_detected_and_single_threes_excluded() {
        // A cross of two open pairs; the center square completes two open threes
        // at once, while the outer holes complete only one each.
        let black = bits(&[112, 114, 98, 128]);
        let mut lines = LineBoards::new(&black, &[0; 8]);
        let moves = double_threat_moves(&mut lines, true);
        assert_eq!(set_positions(&moves), vec![113]);
        assert_eq!(lines, LineBoards::new(&black, &[0; 8]));
    }

    #[test]
    fn four_three_is_a_double_threat() {
        // Square 115 completes a four on row 7 (112,113,114,115, blocked left by
        // white at 111) and an open three on column 10 (100,115,130).
        let black = bits(&[112, 113, 114, 100, 130]);
        let white = bits(&[111]);
        let mut lines = LineBoards::new(&black, &white);
        let moves = double_threat_moves(&mut lines, true);
        assert_eq!(set_positions(&moves), vec![115]);
        assert_eq!(lines, LineBoards::new(&black, &white));
    }

    #[test]
    fn double_three_wins_with_five_ply_distance() {
        let black = bits(&[112, 114, 98, 128]);
        let mut lines = LineBoards::new(&black, &[0; 8]);
        let mut winning = WinningCache::new(&lines);
        let before = (lines.clone(), winning.clone());
        let outcome = solve(&mut lines, &mut winning, true, MAX_PLIES, NODE_BUDGET);
        assert_eq!(outcome.line.as_deref(), Some(&[113u16][..]));
        assert_eq!(outcome.plies, 5);
        assert!(!outcome.exhausted);
        assert_eq!((lines, winning), before);
    }

    #[test]
    fn four_three_win_resolved_through_forced_block() {
        // Square 113 completes a four on row 7 and an open three on column 8, a
        // four-three. The continuous-four recursion converts the three into an
        // open four, proving the win in five plies (the same line VCF found).
        let b = bits(&[110, 111, 112, 128, 143]);
        let w = bits(&[109, 0, 14, 210, 224]);
        for (black, white, attacker) in [(b, w, true), (w, b, false)] {
            let mut lines = LineBoards::new(&black, &white);
            let mut winning = WinningCache::new(&lines);
            let before = (lines.clone(), winning.clone());
            assert!(solve(&mut lines, &mut winning, attacker, 4, NODE_BUDGET)
                .line
                .is_none());
            let proof = solve(&mut lines, &mut winning, attacker, 5, NODE_BUDGET);
            assert_eq!(proof.line.as_deref(), Some(&[113, 114, 98, 83, 158][..]));
            assert_eq!(proof.plies, 5);
            assert!(!proof.exhausted);
            assert_eq!((lines.clone(), winning.clone()), before);
            let limited = solve(&mut lines, &mut winning, attacker, 15, 1);
            assert!(limited.line.is_none());
            assert!(limited.exhausted);
            assert_eq!((lines, winning), before);
        }
    }

    #[test]
    fn forced_block_recursion_restores_state_without_a_win() {
        // A single closed-four threat (113) forces a reply but does not win; the
        // forced-block branch must recurse, fail, and restore every board.
        let black = bits(&[110, 111, 112]);
        let white = bits(&[113]);
        let mut lines = LineBoards::new(&black, &white);
        let mut winning = WinningCache::new(&lines);
        let before = (lines.clone(), winning.clone());
        let outcome = solve(&mut lines, &mut winning, true, MAX_PLIES, NODE_BUDGET);
        assert!(outcome.line.is_none());
        assert!(!outcome.exhausted);
        assert_eq!((lines, winning), before);
    }
}

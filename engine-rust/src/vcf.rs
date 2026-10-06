//! Proof-only continuous-four search. Unknown never means a forced loss.
use crate::bitboards::{Bitboard, positions};
use crate::lines::{LineBoards, WinningCache, geometry};

pub const MAX_PLIES: usize = 15;
pub const NODE_BUDGET: usize = 2048;
pub const HORIZON_PLIES: usize = 7;
pub const HORIZON_NODES: usize = 32;

/// Cheap eligibility test before allocating or probing the horizon cache.
pub fn can_start(lines: &LineBoards, color: bool) -> bool {
    let (own, enemy) = if color {
        (&lines.black, &lines.white)
    } else {
        (&lines.white, &lines.black)
    };
    for line in 0..88 {
        let length = geometry().lengths[line];
        if length < 5 || own[line].count_ones() < 3 {
            continue;
        }
        for start in 0..=length - 5 {
            if ((own[line] >> start) & 31).count_ones() == 3 && (enemy[line] >> start) & 31 == 0 {
                return true;
            }
        }
    }
    false
}

pub struct Outcome {
    pub line: Option<Vec<u16>>,
    pub nodes: usize,
    pub exhausted: bool,
}
struct Solver {
    attacker: bool,
    budget: usize,
    nodes: usize,
    exhausted: bool,
}

/// Every move making a four belongs to a five-cell window with three friendly
/// stones and two holes. Enumerate both holes without normal candidate pruning.
pub fn four_moves(lines: &LineBoards, color: bool) -> Bitboard {
    let (own, enemy) = if color {
        (&lines.black, &lines.white)
    } else {
        (&lines.white, &lines.black)
    };
    let mut board = [0; 8];
    for line in 0..88 {
        let length = geometry().lengths[line];
        if length < 5 || own[line].count_ones() < 3 {
            continue;
        }
        for start in 0..=length - 5 {
            let stones = (own[line] >> start) & 31;
            if stones.count_ones() != 3 || (enemy[line] >> start) & 31 != 0 {
                continue;
            }
            let mut holes = !stones & 31;
            while holes != 0 {
                let p = geometry().cells[line][start + holes.trailing_zeros() as usize];
                board[p >> 5] |= 1 << (p & 31);
                holes &= holes - 1;
            }
        }
    }
    board
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
    ) -> Option<Vec<u16>> {
        if remaining == 0 || !self.tick() {
            return None;
        }
        let own = if self.attacker {
            &winning.black
        } else {
            &winning.white
        };
        if let Some(p) = positions(&own.board, &[0; 8], false).next() {
            return Some(vec![p as u16]);
        }
        let enemy = if self.attacker {
            &winning.white
        } else {
            &winning.black
        };
        if enemy.count >= 2 || remaining < 3 {
            return None;
        }
        let mandatory = if enemy.count == 1 {
            positions(&enemy.board, &[0; 8], false).next()
        } else {
            None
        };
        let candidates = four_moves(lines, self.attacker);
        for p in positions(&candidates, &[0; 8], false) {
            if mandatory.is_some_and(|block| block != p) {
                continue;
            }
            if !self.tick() {
                break;
            }
            lines.update(p, self.attacker, true);
            let undo = winning.refresh(lines, p);
            let own = if self.attacker {
                &winning.black
            } else {
                &winning.white
            };
            let enemy = if self.attacker {
                &winning.white
            } else {
                &winning.black
            };
            let mut result = None;
            if enemy.count == 0 && own.count >= 2 {
                let mut squares = positions(&own.board, &[0; 8], false);
                result = Some(vec![
                    p as u16,
                    squares.next().unwrap() as u16,
                    squares.next().unwrap() as u16,
                ]);
            } else if enemy.count == 0 && own.count == 1 {
                let block = positions(&own.board, &[0; 8], false).next().unwrap();
                lines.update(block, !self.attacker, true);
                let reply_undo = winning.refresh(lines, block);
                result = self.attack(lines, winning, remaining - 2).map(|mut tail| {
                    tail.insert(0, block as u16);
                    tail.insert(0, p as u16);
                    tail
                });
                lines.update(block, !self.attacker, false);
                winning.restore(reply_undo);
            }
            lines.update(p, self.attacker, false);
            winning.restore(undo);
            if result.is_some() {
                return result;
            }
            if self.exhausted {
                break;
            }
        }
        None
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
    let line = solver.attack(lines, winning, max_plies);
    Outcome {
        line,
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
    #[test]
    fn five_ply_ladder_respects_bounds_and_restores_every_representation() {
        let b = bits(&[110, 111, 112, 128, 143]);
        let w = bits(&[109, 0, 14, 210, 224]);
        for (black, white, attacker) in [(b, w, true), (w, b, false)] {
            let mut lines = LineBoards::new(&black, &white);
            let mut cache = WinningCache::new(&lines);
            let before = (lines.clone(), cache.clone());
            assert!(
                solve(&mut lines, &mut cache, attacker, 4, 2048)
                    .line
                    .is_none()
            );
            let proof = solve(&mut lines, &mut cache, attacker, 5, 2048);
            assert_eq!(proof.line.unwrap(), [113, 114, 98, 83, 158]);
            assert!(!proof.exhausted);
            assert_eq!((lines.clone(), cache.clone()), before);
            let limited = solve(&mut lines, &mut cache, attacker, 15, 1);
            assert!(limited.line.is_none());
            assert!(limited.exhausted);
            assert_eq!((lines.clone(), cache.clone()), before);
        }
    }
    #[test]
    fn an_opponent_counter_win_refutes_the_attack() {
        let black = bits(&[110, 111, 112, 128, 143, 39]);
        let white = bits(&[109, 54, 69, 84, 99]);
        let mut lines = LineBoards::new(&black, &white);
        let mut winning = WinningCache::new(&lines);
        let before = (lines.clone(), winning.clone());
        assert!(
            solve(&mut lines, &mut winning, true, 5, 2048)
                .line
                .is_none()
        );
        assert_eq!((lines, winning), before);
    }
}

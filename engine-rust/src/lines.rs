use crate::bitboards::{BOARD_CELLS, BOARD_SIZE, Bitboard, positions};
use crate::patterns::{DIRECTIONS, Pattern, classify};
use std::sync::OnceLock;

pub const LINE_COUNT: usize = 88;
#[derive(Clone, Copy, Default)]
pub struct Membership {
    pub line: usize,
    pub bit: u16,
}
#[derive(Clone, Copy, Default)]
struct Window {
    line: usize,
    shift: i32,
    borders: u16,
}
pub struct Geometry {
    pub cells: [[usize; BOARD_SIZE]; LINE_COUNT],
    pub lengths: [usize; LINE_COUNT],
    pub memberships: [[Membership; 4]; BOARD_CELLS],
    windows: [[Window; 4]; BOARD_CELLS],
    pub affected: [[usize; 36]; BOARD_CELLS],
    pub affected_lengths: [usize; BOARD_CELLS],
}
fn inside(r: i32, c: i32) -> bool {
    (0..15).contains(&r) && (0..15).contains(&c)
}
pub fn geometry() -> &'static Geometry {
    static GEOMETRY: OnceLock<Geometry> = OnceLock::new();
    GEOMETRY.get_or_init(|| {
        let mut result = Geometry {
            cells: [[0; 15]; 88],
            lengths: [0; 88],
            memberships: [[Membership::default(); 4]; 225],
            windows: [[Window::default(); 4]; 225],
            affected: [[0; 36]; 225],
            affected_lengths: [0; 225],
        };
        let mut line = 0;
        for (direction, &(dr, dc)) in DIRECTIONS.iter().enumerate() {
            for row in 0..15 {
                for col in 0..15 {
                    if inside(row - dr, col - dc) {
                        continue;
                    }
                    let (mut r, mut c) = (row, col);
                    while inside(r, c) {
                        let position = r as usize * 15 + c as usize;
                        let index = result.lengths[line];
                        result.cells[line][index] = position;
                        result.memberships[position][direction] = Membership {
                            line,
                            bit: 1 << index,
                        };
                        result.lengths[line] += 1;
                        r += dr;
                        c += dc;
                    }
                    let valid = (1u32 << result.lengths[line]) - 1;
                    for index in 0..result.lengths[line] {
                        let shift = index as i32 - 4;
                        let visible = if shift >= 0 {
                            valid >> shift
                        } else {
                            valid << -shift
                        } & 511;
                        result.windows[result.cells[line][index]][direction] = Window {
                            line,
                            shift,
                            borders: (511 & !visible) as u16,
                        };
                    }
                    line += 1;
                }
            }
        }
        assert_eq!(line, LINE_COUNT);
        for position in 0..225 {
            let row = (position / 15) as i32;
            let col = (position % 15) as i32;
            for (direction, &(dr, dc)) in DIRECTIONS.iter().enumerate() {
                for offset in -4..=4 {
                    let r = row + dr * offset;
                    let c = col + dc * offset;
                    if inside(r, c) {
                        let n = result.affected_lengths[position];
                        result.affected[position][n] =
                            (r as usize * 15 + c as usize) * 4 + direction;
                        result.affected_lengths[position] += 1;
                    }
                }
            }
        }
        result
    })
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LineBoards {
    pub black: [u16; 88],
    pub white: [u16; 88],
}
impl LineBoards {
    pub fn new(black: &Bitboard, white: &Bitboard) -> Self {
        let mut result = Self {
            black: [0; 88],
            white: [0; 88],
        };
        for (board, is_black) in [(black, true), (white, false)] {
            for p in positions(board, &[0; 8], false) {
                result.update(p, is_black, true);
            }
        }
        result
    }
    pub fn update(&mut self, position: usize, black: bool, occupied: bool) {
        let board = if black {
            &mut self.black
        } else {
            &mut self.white
        };
        for member in geometry().memberships[position] {
            if occupied {
                board[member.line] |= member.bit;
            } else {
                board[member.line] &= !member.bit;
            }
        }
    }
    pub fn analyze(&self, black: bool, position: usize, direction: usize) -> Pattern {
        let w = geometry().windows[position][direction];
        let (own, enemy) = if black {
            (&self.black, &self.white)
        } else {
            (&self.white, &self.black)
        };
        let extract = |mask: u16| -> u16 {
            ((if w.shift >= 0 {
                (mask as u32) >> w.shift
            } else {
                (mask as u32) << -w.shift
            }) & 511) as u16
        };
        let blockers = extract(enemy[w.line]) | w.borders;
        classify(extract(own[w.line]) & !blockers, blockers)
    }
}

pub fn winning_line(stones: u16, opponent: u16, length: usize) -> u16 {
    if length < 5 || stones.count_ones() < 4 {
        return 0;
    }
    let s = stones as u32;
    let empty = !(s | opponent as u32) & ((1 << length) - 1);
    let fours = s & (s >> 1) & (s >> 2) & (s >> 3);
    (empty
        & ((fours << 4)
            | (fours >> 1)
            | ((s << 1) & (s >> 1) & (s >> 2) & (s >> 3))
            | ((s << 1) & (s << 2) & (s >> 1) & (s >> 2))
            | ((s << 1) & (s << 2) & (s << 3) & (s >> 1)))) as u16
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WinningColor {
    pub board: Bitboard,
    pub squares: [u16; 88],
    pub references: [u8; 225],
    pub count: usize,
}
impl Default for WinningColor {
    fn default() -> Self {
        Self {
            board: [0; 8],
            squares: [0; 88],
            references: [0; 225],
            count: 0,
        }
    }
}
impl WinningColor {
    fn replace(&mut self, line: usize, next: u16) {
        let mut changed = self.squares[line] ^ next;
        while changed != 0 {
            let index = changed.trailing_zeros() as usize;
            let bit = 1 << index;
            let position = geometry().cells[line][index];
            let board_bit = 1 << (position & 31);
            if next & bit != 0 {
                if self.references[position] == 0 {
                    self.board[position >> 5] |= board_bit;
                    self.count += 1;
                }
                self.references[position] += 1;
            } else {
                self.references[position] -= 1;
                if self.references[position] == 0 {
                    self.board[position >> 5] &= !board_bit;
                    self.count -= 1;
                }
            }
            changed &= changed - 1;
        }
        self.squares[line] = next;
    }
}
#[derive(Clone, Copy, Default)]
struct WinningChange {
    line: usize,
    black: bool,
    previous: u16,
}
pub struct WinningUndo {
    changes: [WinningChange; 8],
    length: usize,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WinningCache {
    pub black: WinningColor,
    pub white: WinningColor,
}
impl WinningCache {
    pub fn new(lines: &LineBoards) -> Self {
        let mut result = Self {
            black: WinningColor::default(),
            white: WinningColor::default(),
        };
        for line in 0..88 {
            let length = geometry().lengths[line];
            result.black.replace(
                line,
                winning_line(lines.black[line], lines.white[line], length),
            );
            result.white.replace(
                line,
                winning_line(lines.white[line], lines.black[line], length),
            );
        }
        result
    }
    pub fn refresh(&mut self, lines: &LineBoards, position: usize) -> WinningUndo {
        let mut undo = WinningUndo {
            changes: [WinningChange::default(); 8],
            length: 0,
        };
        for member in geometry().memberships[position] {
            let line = member.line;
            let length = geometry().lengths[line];
            for black in [true, false] {
                let (own, enemy, state) = if black {
                    (lines.black[line], lines.white[line], &mut self.black)
                } else {
                    (lines.white[line], lines.black[line], &mut self.white)
                };
                let next = winning_line(own, enemy, length);
                if next != state.squares[line] {
                    undo.changes[undo.length] = WinningChange {
                        line,
                        black,
                        previous: state.squares[line],
                    };
                    undo.length += 1;
                    state.replace(line, next);
                }
            }
        }
        undo
    }
    pub fn restore(&mut self, undo: WinningUndo) {
        for change in &undo.changes[..undo.length] {
            (if change.black {
                &mut self.black
            } else {
                &mut self.white
            })
            .replace(change.line, change.previous);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_square_updates_four_lines() {
        for p in 0..225 {
            let mut lines = LineBoards::new(&[0; 8], &[0; 8]);
            lines.update(p, true, true);
            assert_eq!(lines.black.iter().filter(|&&v| v != 0).count(), 4);
            lines.update(p, true, false);
            assert_eq!(lines.black, [0; 88]);
            for direction in 0..4 {
                let m = geometry().memberships[p][direction];
                assert_eq!(geometry().cells[m.line][m.bit.trailing_zeros() as usize], p);
            }
        }
    }
    #[test]
    fn winning_masks_match_placement_scans() {
        for length in 1usize..=9 {
            for code in 0..3u32.pow(length as u32) {
                let mut value = code;
                let (mut s, mut o) = (0u16, 0u16);
                for i in 0..length {
                    match value % 3 {
                        1 => s |= 1 << i,
                        2 => o |= 1 << i,
                        _ => {}
                    };
                    value /= 3;
                }
                let mut expected = 0;
                for i in 0..length {
                    if (s | o) & (1 << i) != 0 {
                        continue;
                    }
                    let placed = s | (1 << i);
                    for start in 0..length.saturating_sub(4) {
                        let mask = 31 << start;
                        if placed & mask == mask && mask & (1 << i) != 0 {
                            expected |= 1 << i;
                        }
                    }
                }
                assert_eq!(winning_line(s, o, length), expected);
            }
        }
    }
}

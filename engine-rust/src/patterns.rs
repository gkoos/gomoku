use crate::bitboards::{BOARD_SIZE, Bitboard, contains};

pub const DIRECTIONS: [(i32, i32); 4] = [(0, 1), (1, 0), (1, 1), (1, -1)];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Pattern {
    pub stones: u32,
    pub windows: u32,
    pub winning_moves: u32,
    pub open_three: bool,
    pub open_two: bool,
}

impl Pattern {
    pub fn packed(self) -> u32 {
        self.stones
            | (self.windows << 8)
            | (self.winning_moves << 16)
            | ((self.open_three as u32) << 24)
            | ((self.open_two as u32) << 25)
    }
    pub fn score(self) -> i32 {
        match self.stones {
            5.. => 100_000,
            4 => {
                if self.winning_moves >= 2 {
                    20_000
                } else {
                    10_000
                }
            }
            3 => {
                if self.open_three {
                    1_000
                } else {
                    100
                }
            }
            2 => {
                if self.open_two {
                    100
                } else {
                    10
                }
            }
            1 => self.windows.min(2) as i32,
            _ => 0,
        }
    }
}

fn open_formation(friendly: u16, blockers: u16, count: u32) -> bool {
    (0..=3).any(|start| {
        let ends = (1 << start) | (1 << (start + 5));
        let interior = 0b1111 << (start + 1);
        (friendly | blockers) & ends == 0
            && blockers & interior == 0
            && (friendly & interior).count_ones() == count
    })
}

pub fn classify(friendly: u16, blockers: u16) -> Pattern {
    let mut stones = 0;
    let mut windows = 0;
    let mut winning_squares = 0u16;
    for start in 0..=4 {
        let window = 0b11111 << start;
        if blockers & window != 0 {
            continue;
        }
        let count = (friendly & window).count_ones();
        if count > stones {
            stones = count;
            windows = 1;
        } else if count == stones {
            windows += 1;
        }
        if count == 4 {
            winning_squares |= window & !friendly;
        }
    }
    Pattern {
        stones,
        windows,
        winning_moves: winning_squares.count_ones(),
        open_three: stones == 3 && open_formation(friendly, blockers, 3),
        open_two: stones == 2 && open_formation(friendly, blockers, 2),
    }
}

pub fn analyze(own: &Bitboard, opponent: &Bitboard, position: usize, direction: usize) -> Pattern {
    let row = (position / BOARD_SIZE) as i32;
    let col = (position % BOARD_SIZE) as i32;
    let (dr, dc) = DIRECTIONS[direction];
    let mut friendly = 0u16;
    let mut blockers = 0u16;
    for offset in -4..=4 {
        let r = row + dr * offset;
        let c = col + dc * offset;
        let bit = 1 << (offset + 4);
        if !(0..15).contains(&r) || !(0..15).contains(&c) {
            blockers |= bit;
            continue;
        }
        let p = r as usize * BOARD_SIZE + c as usize;
        if contains(opponent, p) {
            blockers |= bit;
        } else if contains(own, p) {
            friendly |= bit;
        }
    }
    classify(friendly, blockers)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn open_and_closed_four() {
        let open = classify(0b1111 << 3, 0);
        assert_eq!(open.winning_moves, 2);
        assert_eq!(open.score(), 20_000);
        let closed = classify(0b1111 << 3, 1 << 2);
        assert_eq!(closed.winning_moves, 1);
        assert_eq!(closed.score(), 10_000);
    }
    #[test]
    fn no_usable_window() {
        assert_eq!(classify(1 << 4, 511 & !(1 << 4)).score(), 0);
    }
}

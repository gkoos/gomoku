pub const DEFAULT_WEIGHTS: [i32; 8] = [100_000, 20_000, 10_000, 1_000, 100, 100, 10, 1];

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
        self.score_with(&DEFAULT_WEIGHTS)
    }
    /// The open-three component only: the potential that converts into a forcing
    /// win next move. Used by the initiative term; five/four categories are
    /// excluded because the search already resolves them.
    pub fn forcing_with(self, weights: &[i32; 8]) -> i32 {
        if self.stones == 3 && self.open_three {
            weights[3]
        } else {
            0
        }
    }
    /// Five, open/closed four, open/closed three, open/closed two, window.
    pub fn score_with(self, weights: &[i32; 8]) -> i32 {
        match self.stones {
            5.. => weights[0],
            4 => {
                if self.winning_moves >= 2 {
                    weights[1]
                } else {
                    weights[2]
                }
            }
            3 => {
                if self.open_three {
                    weights[3]
                } else {
                    weights[4]
                }
            }
            2 => {
                if self.open_two {
                    weights[5]
                } else {
                    weights[6]
                }
            }
            1 => self.windows.min(2) as i32 * weights[7],
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

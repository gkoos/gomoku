use crate::bitboards::{BOARD_SIZE, Bitboard, contains};

pub const DIRECTIONS: [(i32, i32); 4] = [(0, 1), (1, 0), (1, 1), (1, -1)];

pub use crate::pattern_reference::Pattern;

const fn ternary_indices() -> [usize; 512] {
    let mut indices = [0; 512];
    let mut mask = 0;
    while mask < 512 {
        let mut bit = 0;
        let mut weight = 1;
        while bit < 9 {
            if mask & (1 << bit) != 0 {
                indices[mask] += weight;
            }
            bit += 1;
            weight *= 3;
        }
        mask += 1;
    }
    indices
}
const TERNARY: [usize; 512] = ternary_indices();
include!(concat!(env!("OUT_DIR"), "/pattern_table.rs"));

pub fn classify(friendly: u16, blockers: u16) -> Pattern {
    let blockers = blockers & 511;
    let friendly = friendly & 511 & !blockers;
    let packed = PATTERNS[TERNARY[friendly as usize] + 2 * TERNARY[blockers as usize]] as u32;
    Pattern {
        stones: packed & 7,
        windows: (packed >> 3) & 7,
        winning_moves: (packed >> 6) & 15,
        open_three: packed & (1 << 10) != 0,
        open_two: packed & (1 << 11) != 0,
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
    fn lookup_matches_reference_for_every_mask_pair() {
        for blockers in 0..512 {
            for friendly in 0..512 {
                assert_eq!(
                    classify(friendly, blockers),
                    crate::pattern_reference::classify(friendly & !blockers, blockers)
                );
            }
        }
        assert_eq!(classify(u16::MAX, u16::MAX), classify(0, 511));
    }
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

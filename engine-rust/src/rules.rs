use crate::bitboards::{Bitboard, full, overlap, positions};
use crate::patterns::DIRECTIONS;
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BoardResult {
    Winner(bool),
    Draw,
    Invalid,
}
pub fn win(board: &Bitboard, position: usize) -> bool {
    let row = (position / 15) as i32;
    let col = (position % 15) as i32;
    for (dr, dc) in DIRECTIONS {
        let mut count = 1;
        for sign in [-1, 1] {
            for step in 1..5 {
                let r = row + dr * step * sign;
                let c = col + dc * step * sign;
                if !(0..15).contains(&r) || !(0..15).contains(&c) {
                    break;
                }
                if crate::bitboards::contains(board, r as usize * 15 + c as usize) {
                    count += 1;
                } else {
                    break;
                }
            }
        }
        if count >= 5 {
            return true;
        }
    }
    false
}
pub fn result(black: &Bitboard, white: &Bitboard) -> Option<BoardResult> {
    if overlap(black, white) {
        return Some(BoardResult::Invalid);
    }
    let mut winner = None;
    for (color, board) in [(true, black), (false, white)] {
        if positions(board, &[0; 8], false).any(|p| win(board, p)) {
            if winner.is_some() {
                return Some(BoardResult::Invalid);
            }
            winner = Some(color);
        }
    }
    if let Some(color) = winner {
        Some(BoardResult::Winner(color))
    } else if full(black, white) {
        Some(BoardResult::Draw)
    } else {
        None
    }
}

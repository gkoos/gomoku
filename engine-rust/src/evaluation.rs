use crate::bitboards::{Bitboard, contains, positions};
use crate::pattern_reference::DEFAULT_WEIGHTS;
use crate::patterns::analyze;

pub const MAX_STATIC_SCORE: i32 = 500_000;

/// Preserve the JavaScript full-board evaluator's perspective precedence on overlaps.
pub fn evaluate(black: &Bitboard, white: &Bitboard, perspective_black: bool) -> i32 {
    evaluate_with(black, white, perspective_black, &DEFAULT_WEIGHTS)
}

/// Like [`evaluate`] but with explicit pattern weights, so the candidate-ordering
/// key can share the evaluator's configured scoring.
pub fn evaluate_with(
    black: &Bitboard,
    white: &Bitboard,
    perspective_black: bool,
    weights: &[i32; 8],
) -> i32 {
    let (own, opponent) = if perspective_black {
        (black, white)
    } else {
        (white, black)
    };
    let mut score = 0;
    for position in positions(own, opponent, false) {
        let is_own = contains(own, position);
        let (player, enemy) = if is_own {
            (own, opponent)
        } else {
            (opponent, own)
        };
        let contribution: i32 = (0..4)
            .map(|direction| analyze(player, enemy, position, direction).score_with(weights))
            .sum();
        score += if is_own { contribution } else { -contribution };
    }
    score.clamp(-MAX_STATIC_SCORE, MAX_STATIC_SCORE)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn empty_and_signed_word_stone() {
        assert_eq!(evaluate(&[0; 8], &[0; 8], true), 0);
        let mut b = [0; 8];
        b[0] = 1 << 31;
        assert!(evaluate(&b, &[0; 8], true) > 0);
        assert_eq!(evaluate(&b, &[0; 8], true), -evaluate(&b, &[0; 8], false));
    }
}

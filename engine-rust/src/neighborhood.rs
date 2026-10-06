use crate::bitboards::{Bitboard, positions};

/// Radius-two occupancy counts, including the center square, for both colors.
pub struct Density(pub [u8; 225]);
impl Density {
    pub fn new(black: &Bitboard, white: &Bitboard) -> Self {
        let mut result = Self([0; 225]);
        for position in positions(black, white, false) {
            result.update(position, true);
        }
        result
    }
    pub fn update(&mut self, position: usize, added: bool) {
        let row = position / 15;
        let col = position % 15;
        for r in row.saturating_sub(2)..=(row + 2).min(14) {
            for c in col.saturating_sub(2)..=(col + 2).min(14) {
                let count = &mut self.0[r * 15 + c];
                if added {
                    *count += 1;
                } else {
                    *count -= 1;
                }
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::incremental::Evaluator;
    fn verify(state: &Evaluator) {
        let occupied: Vec<_> = positions(&state.black, &state.white, false).collect();
        for p in 0usize..225 {
            let expected = occupied
                .iter()
                .filter(|&&q| (p / 15).abs_diff(q / 15) <= 2 && (p % 15).abs_diff(q % 15) <= 2)
                .count();
            assert_eq!(state.density.0[p] as usize, expected, "square {p}");
        }
    }
    #[test]
    fn density_matches_square_reference_through_dense_make_undo_and_errors() {
        let mut state = Evaluator::new([0; 8], [0; 8], true);
        let mut tokens = Vec::new();
        for i in 0..225 {
            let p = (i * 73) % 225;
            tokens.push(state.make_move(p, i % 2 == 0).unwrap());
            verify(&state);
            let before = state.density.0;
            assert!(state.make_move(p, false).is_err());
            assert!(state.make_move(225, true).is_err());
            assert!(state.undo_move(0).is_err());
            assert_eq!(state.density.0, before);
        }
        assert_eq!(state.density.0[112], 25);
        assert_eq!(state.density.0[0], 9);
        while let Some(token) = tokens.pop() {
            state.undo_move(token).unwrap();
            verify(&state);
        }
        assert_eq!(state.density.0, [0; 225]);
        let token = state.make_move(31, true).unwrap();
        state.undo_move(token).unwrap();
        state.make_move(224, false).unwrap();
        let before = state.density.0;
        assert!(state.undo_move(token).is_err());
        assert_eq!(state.density.0, before);
        verify(&state);
        let rebuilt = Evaluator::new(state.black, state.white, false);
        assert_eq!(rebuilt.density.0, state.density.0);
    }
    #[test]
    fn leaf_chain_skips_density_and_restores_before_candidate_generation() {
        let mut state = Evaluator::new([0; 8], [0; 8], true);
        let parent = state.make_move(112, true).unwrap();
        let before = state.density.0;
        let leaf = state.make_leaf_move(113, false).unwrap();
        let horizon = state.make_leaf_move(127, true).unwrap();
        assert_eq!(state.density.0, before);
        assert_eq!(
            state.score(),
            crate::evaluation::evaluate(&state.black, &state.white, true)
        );
        state.undo_move(horizon).unwrap();
        state.undo_move(leaf).unwrap();
        verify(&state);
        state.make_move(224, false).unwrap();
        verify(&state);
        assert!(state.undo_move(parent).is_err());
        verify(&state);
    }
}

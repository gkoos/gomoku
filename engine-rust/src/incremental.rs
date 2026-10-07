use crate::bitboards::{BOARD_CELLS, Bitboard, contains, positions};
use crate::evaluation::MAX_STATIC_SCORE;
use crate::lines::{LineBoards, WinningCache, WinningUndo, geometry};
use crate::neighborhood::Density;

struct Frame {
    token: u32,
    position: usize,
    black: bool,
    total: i32,
    scores: [i32; 36],
    winning: WinningUndo,
    density_updated: bool,
    nnue_accumulator: Option<Vec<f32>>,
}
/// Owns reversible state. History frames use fixed buffers; no per-move heap allocation.
pub struct Evaluator {
    pub black: Bitboard,
    pub white: Bitboard,
    pub lines: LineBoards,
    pub winning: WinningCache,
    pub density: Density,
    scores: [i32; 900],
    total: i32,
    perspective_black: bool,
    history: Vec<Frame>,
    next_token: u32,
    weights: [i32; 8],
    nnue: Option<crate::nnue::Network>,
    pattern: Option<crate::pattern_eval::PatternNet>,
}
impl Evaluator {
    pub fn new(black: Bitboard, white: Bitboard, perspective_black: bool) -> Self {
        let lines = LineBoards::new(&black, &white);
        let winning = WinningCache::new(&lines);
        Self::with_lines(black, white, perspective_black, lines, winning)
    }
    pub fn with_lines(
        black: Bitboard,
        white: Bitboard,
        perspective_black: bool,
        lines: LineBoards,
        winning: WinningCache,
    ) -> Self {
        let mut result = Self {
            black,
            white,
            lines,
            winning,
            density: Density::new(&black, &white),
            scores: [0; 900],
            total: 0,
            perspective_black,
            history: Vec::with_capacity(BOARD_CELLS),
            next_token: 0,
            weights: crate::pattern_reference::DEFAULT_WEIGHTS,
            nnue: None,
            pattern: None,
        };
        for position in positions(&black, &white, false) {
            for direction in 0..4 {
                let index = position * 4 + direction;
                result.scores[index] = result.contribution(index);
                result.total += result.scores[index];
            }
        }
        result
    }
    fn contribution(&self, index: usize) -> i32 {
        let position = index >> 2;
        let black = contains(&self.black, position);
        if !black && !contains(&self.white, position) {
            return 0;
        }
        let score = self
            .lines
            .analyze(black, position, index & 3)
            .score_with(&self.weights);
        if black { score } else { -score }
    }
    pub fn set_nnue(&mut self, bytes: &[u8], scale: f32) -> Result<(), &'static str> {
        if !self.history.is_empty() {
            return Err("NNUE cannot change during a move sequence");
        }
        self.nnue = Some(crate::nnue::Network::load(
            bytes,
            &self.black,
            &self.white,
            scale,
        )?);
        Ok(())
    }
    pub fn nnue_logit(&self, black_to_move: bool) -> Option<f32> {
        self.nnue.as_ref().map(|n| n.logit(black_to_move))
    }
    pub fn set_pattern(&mut self, bytes: &[u8], scale: f32) -> Result<(), &'static str> {
        if !self.history.is_empty() {
            return Err("Pattern net cannot change during a move sequence");
        }
        self.pattern = Some(crate::pattern_eval::PatternNet::load(bytes, scale)?);
        Ok(())
    }
    pub fn score_for_turn(&self, black_to_move: bool) -> i32 {
        if let Some(net) = &self.pattern {
            return net.score(&self.black, &self.white, black_to_move, self.perspective_black);
        }
        self.nnue.as_ref().map_or_else(
            || self.score(),
            |n| n.score(black_to_move, self.perspective_black),
        )
    }
    pub fn score(&self) -> i32 {
        (if self.perspective_black {
            self.total
        } else {
            -self.total
        })
        .clamp(-MAX_STATIC_SCORE, MAX_STATIC_SCORE)
    }
    pub fn set_weights(&mut self, weights: [i32; 8]) -> Result<(), &'static str> {
        if !self.history.is_empty() {
            return Err("Weights cannot change during a move sequence");
        }
        if weights
            .iter()
            .any(|&weight| !(0..=100_000).contains(&weight))
        {
            return Err("Weights must be integers between 0 and 100000");
        }
        self.weights = weights;
        self.total = 0;
        for index in 0..900 {
            self.scores[index] = self.contribution(index);
            self.total += self.scores[index];
        }
        Ok(())
    }
    pub fn history_length(&self) -> usize {
        self.history.len()
    }
    pub fn make_move(&mut self, position: usize, black: bool) -> Result<u32, &'static str> {
        self.place(position, black, true)
    }
    /// Search-only leaf/horizon placement. Undo before generating candidates;
    /// these branches read evaluation/winning caches but never density.
    pub fn make_leaf_move(&mut self, position: usize, black: bool) -> Result<u32, &'static str> {
        self.place(position, black, false)
    }
    fn place(
        &mut self,
        position: usize,
        black: bool,
        density_updated: bool,
    ) -> Result<u32, &'static str> {
        if position >= BOARD_CELLS {
            return Err("Move is outside the board");
        }
        if contains(&self.black, position) || contains(&self.white, position) {
            return Err("Move occupies an existing stone");
        }
        let token = self
            .next_token
            .checked_add(1)
            .ok_or("Move token limit reached")?;
        let board = if black {
            &mut self.black
        } else {
            &mut self.white
        };
        board[position >> 5] |= 1 << (position & 31);
        if density_updated {
            self.density.update(position, true);
        }
        self.lines.update(position, black, true);
        let winning = self.winning.refresh(&self.lines, position);
        let mut frame = Frame {
            token,
            position,
            black,
            total: self.total,
            scores: [0; 36],
            winning,
            density_updated,
            nnue_accumulator: self.nnue.as_ref().map(|n| n.accumulator.clone()),
        };
        if let Some(n) = &mut self.nnue {
            n.place(position, black);
        }
        if self.nnue.is_none() {
            let g = geometry();
            for (offset, &index) in g.affected[position][..g.affected_lengths[position]]
                .iter()
                .enumerate()
            {
                frame.scores[offset] = self.scores[index];
                let next = self.contribution(index);
                self.total += next - self.scores[index];
                self.scores[index] = next;
            }
        }
        self.history.push(frame);
        self.next_token = token;
        Ok(token)
    }
    pub fn undo_move(&mut self, token: u32) -> Result<(), &'static str> {
        if self.history.last().is_none_or(|frame| frame.token != token) {
            return Err("Moves must be undone in reverse order");
        }
        let frame = self.history.pop().expect("validated history");
        let board = if frame.black {
            &mut self.black
        } else {
            &mut self.white
        };
        board[frame.position >> 5] &= !(1 << (frame.position & 31));
        if frame.density_updated {
            self.density.update(frame.position, false);
        }
        self.lines.update(frame.position, frame.black, false);
        self.winning.restore(frame.winning);
        if self.nnue.is_none() {
            let g = geometry();
            for (offset, &index) in g.affected[frame.position][..g.affected_lengths[frame.position]]
                .iter()
                .enumerate()
            {
                self.scores[index] = frame.scores[offset];
            }
        }
        if let (Some(n), Some(accumulator)) = (&mut self.nnue, frame.nnue_accumulator) {
            n.accumulator = accumulator;
        }
        self.total = frame.total;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn custom_weights_follow_make_undo_and_reject_mid_sequence_changes() {
        let weights = [50_000, 12_000, 7_000, 777, 77, 55, 5, 2];
        let mut state = Evaluator::new([0; 8], [0; 8], true);
        state.set_weights(weights).unwrap();
        let mut tokens = Vec::new();
        for (i, position) in [112, 97, 113, 98, 114, 99, 115, 100]
            .into_iter()
            .enumerate()
        {
            tokens.push(state.make_move(position, i % 2 == 0).unwrap());
            let mut expected = 0;
            for p in positions(&state.black, &state.white, false) {
                let black = contains(&state.black, p);
                for direction in 0..4 {
                    let (own, enemy) = if black {
                        (&state.black, &state.white)
                    } else {
                        (&state.white, &state.black)
                    };
                    let score =
                        crate::patterns::analyze(own, enemy, p, direction).score_with(&weights);
                    expected += if black { score } else { -score };
                }
            }
            assert_eq!(
                state.score(),
                expected.clamp(-MAX_STATIC_SCORE, MAX_STATIC_SCORE)
            );
            assert!(state.set_weights(weights).is_err());
        }
        for token in tokens.into_iter().rev() {
            state.undo_move(token).unwrap();
        }
        assert_eq!(state.score(), 0);
        assert!(state.set_weights([100_001; 8]).is_err());
        state.set_weights(weights).unwrap();
    }
    #[test]
    fn make_undo_and_error_restoration() {
        let mut state = Evaluator::new([0; 8], [0; 8], true);
        let first = state.make_move(31, true).unwrap();
        let second = state.make_move(224, false).unwrap();
        assert!(state.undo_move(first).is_err());
        assert!(state.make_move(31, false).is_err());
        assert!(state.make_move(225, true).is_err());
        assert_eq!(state.history_length(), 2);
        assert_eq!(state.lines, LineBoards::new(&state.black, &state.white));
        assert_eq!(state.winning, WinningCache::new(&state.lines));
        state.undo_move(second).unwrap();
        state.undo_move(first).unwrap();
        assert_eq!(state.black, [0; 8]);
        assert_eq!(state.white, [0; 8]);
        assert_eq!(state.score(), 0);
        assert!(state.undo_move(first).is_err());
        let third = state.make_move(31, true).unwrap();
        assert_ne!(first, third);
        assert!(state.undo_move(first).is_err());
        state.undo_move(third).unwrap();
    }
    #[test]
    fn crossing_threat_survives_removing_one_line() {
        let mut b = [0; 8];
        for p in [108, 109, 110, 111, 52, 67, 82] {
            b[p >> 5] |= 1 << (p & 31);
        }
        let mut state = Evaluator::new(b, [0; 8], true);
        let token = state.make_move(97, true).unwrap();
        assert_eq!(state.winning.black.references[112], 2);
        state.undo_move(token).unwrap();
        assert_eq!(state.winning.black.references[112], 1);
        assert!(contains(&state.winning.black.board, 112));
    }
    #[test]
    fn dense_sequence_matches_reconstruction() {
        let mut state = Evaluator::new([0; 8], [0; 8], false);
        let mut tokens = Vec::new();
        for i in 0..225 {
            let p = (i * 97) % 225;
            tokens.push(state.make_move(p, i % 2 == 0).unwrap());
            assert_eq!(
                state.score(),
                crate::evaluation::evaluate(&state.black, &state.white, false)
            );
            assert_eq!(state.lines, LineBoards::new(&state.black, &state.white));
            assert_eq!(state.winning, WinningCache::new(&state.lines));
        }
        while let Some(token) = tokens.pop() {
            state.undo_move(token).unwrap();
            assert_eq!(
                state.score(),
                crate::evaluation::evaluate(&state.black, &state.white, false)
            );
            assert_eq!(state.winning, WinningCache::new(&state.lines));
        }
    }
}

//! Computational engine primitives; browser integration remains in JavaScript.
pub mod bitboards;
pub mod evaluation;
pub mod patterns;

use bitboards::Bitboard;
use wasm_bindgen::prelude::*;

fn board(words: &[u32]) -> Result<Bitboard, JsValue> {
    words
        .try_into()
        .map_err(|_| JsValue::from_str("A bitboard requires eight words"))
}

/// Packed result: stones, windows and winning moves in successive bytes;
/// open-three and open-two flags occupy bits 24 and 25.
#[wasm_bindgen]
pub fn classify_pattern(friendly: u16, blockers: u16) -> u32 {
    patterns::classify(friendly & 511 & !blockers, blockers & 511).packed()
}

#[wasm_bindgen]
pub fn analyze_pattern(
    own: &[u32],
    opponent: &[u32],
    position: u32,
    direction: u32,
) -> Result<u32, JsValue> {
    if position >= 225 || direction >= 4 {
        return Err(JsValue::from_str("Position or direction outside the board"));
    }
    Ok(patterns::analyze(
        &board(own)?,
        &board(opponent)?,
        position as usize,
        direction as usize,
    )
    .packed())
}

#[wasm_bindgen]
pub fn evaluate_position(
    black: &[u32],
    white: &[u32],
    perspective_black: bool,
) -> Result<i32, JsValue> {
    Ok(evaluation::evaluate(
        &board(black)?,
        &board(white)?,
        perspective_black,
    ))
}

#[wasm_bindgen]
pub fn occupied_positions(black: &[u32], white: &[u32]) -> Result<Vec<u32>, JsValue> {
    Ok(bitboards::positions(&board(black)?, &board(white)?, false)
        .map(|p| p as u32)
        .collect())
}

#[wasm_bindgen]
pub fn empty_positions(black: &[u32], white: &[u32]) -> Result<Vec<u32>, JsValue> {
    Ok(bitboards::positions(&board(black)?, &board(white)?, true)
        .map(|p| p as u32)
        .collect())
}

#[wasm_bindgen]
pub fn boards_overlap(black: &[u32], white: &[u32]) -> Result<bool, JsValue> {
    Ok(bitboards::overlap(&board(black)?, &board(white)?))
}

#[wasm_bindgen]
pub fn boards_full(black: &[u32], white: &[u32]) -> Result<bool, JsValue> {
    Ok(bitboards::full(&board(black)?, &board(white)?))
}
pub mod incremental;
pub mod lines;

/// Stateful prototype interface. Array getters return copies, not mutable internal views.
#[wasm_bindgen]
pub struct SearchState {
    inner: incremental::Evaluator,
}
#[wasm_bindgen]
impl SearchState {
    #[wasm_bindgen(constructor)]
    pub fn new(
        black: &[u32],
        white: &[u32],
        perspective_black: bool,
    ) -> Result<SearchState, JsValue> {
        Ok(Self {
            inner: incremental::Evaluator::new(board(black)?, board(white)?, perspective_black),
        })
    }
    pub fn score(&self) -> i32 {
        self.inner.score()
    }
    pub fn history_length(&self) -> u32 {
        self.inner.history_length() as u32
    }
    pub fn make_move(&mut self, position: u32, black: bool) -> Result<u32, JsValue> {
        self.inner
            .make_move(position as usize, black)
            .map_err(JsValue::from_str)
    }
    pub fn undo_move(&mut self, token: u32) -> Result<(), JsValue> {
        self.inner.undo_move(token).map_err(JsValue::from_str)
    }
    pub fn occupancy(&self, black: bool) -> Vec<u32> {
        (if black {
            self.inner.black
        } else {
            self.inner.white
        })
        .to_vec()
    }
    pub fn line_masks(&self, black: bool) -> Vec<u16> {
        (if black {
            self.inner.lines.black
        } else {
            self.inner.lines.white
        })
        .to_vec()
    }
    pub fn winning_squares(&self, black: bool) -> Vec<u32> {
        (if black {
            self.inner.winning.black.board
        } else {
            self.inner.winning.white.board
        })
        .to_vec()
    }
    pub fn winning_references(&self, black: bool) -> Vec<u8> {
        (if black {
            self.inner.winning.black.references
        } else {
            self.inner.winning.white.references
        })
        .to_vec()
    }
    pub fn has_immediate_threat(&self, black: bool) -> bool {
        (if black {
            self.inner.winning.black.count
        } else {
            self.inner.winning.white.count
        }) != 0
    }
    pub fn analyze_pattern(
        &self,
        position: u32,
        direction: u32,
        black: bool,
    ) -> Result<u32, JsValue> {
        if position >= 225 || direction >= 4 {
            return Err(JsValue::from_str("Position or direction outside the board"));
        }
        Ok(self
            .inner
            .lines
            .analyze(black, position as usize, direction as usize)
            .packed())
    }
}

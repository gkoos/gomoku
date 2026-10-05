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

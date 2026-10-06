//! Computational engine primitives; browser integration remains in JavaScript.
pub mod bitboards;
pub mod evaluation;
pub mod pattern_reference;
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
pub mod moves;
pub mod neighborhood;

/// Triples of position, priority, tactical classification (-1 for opening moves).
#[wasm_bindgen]
pub fn generate_candidates(
    black: &[u32],
    white: &[u32],
    player_black: bool,
) -> Result<Vec<i32>, JsValue> {
    let black = board(black)?;
    let white = board(white)?;
    let lines = lines::LineBoards::new(&black, &white);
    let winning = lines::WinningCache::new(&lines);
    let mut result = moves::Candidates::default();
    moves::generate_into(&black, &white, player_black, &winning, &mut result);
    Ok(result.packed())
}

#[wasm_bindgen]
impl SearchState {
    pub fn candidates(&self, player_black: bool) -> Vec<i32> {
        let mut result = moves::Candidates::default();
        moves::generate_from_state(&self.inner, player_black, &mut result);
        result.packed()
    }
}
pub mod rules;
pub mod search;
pub mod transposition;
pub mod zobrist;

#[wasm_bindgen]
pub struct PositionHasher {
    inner: zobrist::Hasher,
}
#[wasm_bindgen]
impl PositionHasher {
    #[wasm_bindgen(constructor)]
    pub fn new(black: &[u32], white: &[u32], black_to_move: bool) -> Result<Self, JsValue> {
        Ok(Self {
            inner: zobrist::Hasher::new(&board(black)?, &board(white)?, black_to_move),
        })
    }
    pub fn words(&self) -> Vec<u32> {
        self.inner.words.to_vec()
    }
    pub fn black_to_move(&self) -> bool {
        self.inner.black_to_move
    }
    pub fn toggle_move(&mut self, position: u32, black: bool) -> Result<(), JsValue> {
        if position >= 225 {
            return Err(JsValue::from_str("Move is outside the board"));
        }
        self.inner.toggle(position as usize, black);
        Ok(())
    }
}

/// One synchronous completed depth per call; no browser orchestration yet.
#[wasm_bindgen]
pub struct SearchEngine {
    inner: search::Search,
}
#[wasm_bindgen]
impl SearchEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(
        black: &[u32],
        white: &[u32],
        perspective_black: bool,
        max_depth: u32,
        extension: u32,
        table_capacity: u32,
    ) -> Result<Self, JsValue> {
        Ok(Self {
            inner: search::Search::new(
                board(black)?,
                board(white)?,
                perspective_black,
                max_depth as usize,
                extension as usize,
                table_capacity as usize,
            )
            .map_err(JsValue::from_str)?,
        })
    }
    pub fn next_depth(&mut self) -> Result<Vec<f64>, JsValue> {
        Ok(self
            .inner
            .next_iteration()
            .map_err(JsValue::from_str)?
            .map_or_else(Vec::new, |i| i.packed()))
    }
    pub fn fixed_depth(
        &mut self,
        depth: u32,
        maximizing: bool,
        alpha: i32,
        beta: i32,
    ) -> Result<Vec<f64>, JsValue> {
        Ok(self
            .inner
            .fixed(depth as usize, maximizing, alpha, beta)
            .map_err(JsValue::from_str)?
            .packed())
    }
    pub fn hash_words(&self) -> Vec<u32> {
        self.inner.hasher.words.to_vec()
    }
    pub fn black_to_move(&self) -> bool {
        self.inner.hasher.black_to_move
    }
    pub fn occupancy(&self, black: bool) -> Vec<u32> {
        (if black {
            self.inner.state.black
        } else {
            self.inner.state.white
        })
        .to_vec()
    }
    pub fn history_length(&self) -> u32 {
        self.inner.state.history_length() as u32
    }
}
pub mod root;

/// Complete root selection followed, when necessary, by iterative search.
#[wasm_bindgen]
pub struct MoveEngine {
    choice: i32,
    search: Option<search::Search>,
}
#[wasm_bindgen]
impl MoveEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(
        black: &[u32],
        white: &[u32],
        computer_black: bool,
        difficulty: u32,
        extension: u32,
        table_capacity: u32,
    ) -> Result<Self, JsValue> {
        if difficulty > 3 || extension > 225 || table_capacity > 1_000_000 {
            return Err(JsValue::from_str(
                "Invalid difficulty or search configuration",
            ));
        }
        let prepared = root::prepare(
            board(black)?,
            board(white)?,
            computer_black,
            difficulty == 0,
        );
        let choice = prepared.choice;
        let search = if choice == -2 {
            let state = incremental::Evaluator::with_lines(
                prepared.black,
                prepared.white,
                computer_black,
                prepared.lines,
                prepared.winning,
            );
            Some(
                search::Search::with_state(
                    state,
                    computer_black,
                    [0, 6, 8, 10][difficulty as usize],
                    extension as usize,
                    table_capacity as usize,
                )
                .map_err(JsValue::from_str)?,
            )
        } else {
            None
        };
        Ok(Self { choice, search })
    }
    pub fn root_move(&self) -> i32 {
        self.choice
    }
    pub fn next_depth(&mut self) -> Result<Vec<f64>, JsValue> {
        match &mut self.search {
            Some(search) => Ok(search
                .next_iteration()
                .map_err(JsValue::from_str)?
                .map_or_else(Vec::new, |i| i.packed())),
            None => Ok(Vec::new()),
        }
    }
}

/// Diagnostic root-only selection: -2 requires search, -1 is terminal.
#[wasm_bindgen]
pub fn select_root(
    black: &[u32],
    white: &[u32],
    computer_black: bool,
    easy: bool,
) -> Result<i32, JsValue> {
    Ok(root::prepare(board(black)?, board(white)?, computer_black, easy).choice)
}
#[wasm_bindgen]
pub fn score_root_move(
    black: &[u32],
    white: &[u32],
    position: u32,
    computer_black: bool,
    priority: i32,
) -> Result<f64, JsValue> {
    let b = board(black)?;
    let w = board(white)?;
    if position >= 225
        || bitboards::contains(&b, position as usize)
        || bitboards::contains(&w, position as usize)
    {
        return Err(JsValue::from_str("Move must be an empty board square"));
    }
    Ok(root::score_move(
        &b,
        &w,
        &mut lines::LineBoards::new(&b, &w),
        position as usize,
        computer_black,
        priority,
    ))
}

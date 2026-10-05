import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createIncrementalEvaluator } from '../src/ai/incremental-evaluation.js';
import {
  createLineBitboards,
  findWinningSquares,
} from '../src/ai/line-bitboards.js';
import { analyzePackedLinePattern } from '../src/ai/patterns.js';
import { evaluatePosition } from '../src/ai/evaluation.js';
const wasm = createRequire(import.meta.url)(
  '../engine-rust/pkg/nodejs/gomoku_engine.js',
);
const words = (board) => Array.from(board, (v) => v >>> 0);
const packed = (p) =>
  p.stones |
  (p.windows << 8) |
  (p.winningMoves << 16) |
  (p.openThree << 24) |
  (p.openTwo << 25);
let seed = 731,
  checks = 0;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
function shuffle() {
  const p = Array.from({ length: 225 }, (_, i) => i);
  for (let i = 224; i > 0; i--) {
    const j = random() % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p;
}
function verify(state, reference, b, w, perspective, allPatterns = false) {
  const lines = createLineBitboards(b, w);
  assert.equal(state.score(), reference.getScore());
  assert.equal(
    state.score(),
    evaluatePosition(
      b,
      w,
      perspective,
      perspective === 'black' ? 'white' : 'black',
    ),
  );
  for (const [color, isBlack] of [
    ['black', true],
    ['white', false],
  ]) {
    assert.deepEqual([...state.occupancy(isBlack)], words(isBlack ? b : w));
    assert.deepEqual([...state.line_masks(isBlack)], [...lines[color]]);
    assert.deepEqual(
      [...state.line_masks(isBlack)],
      [...reference.lineBitboards[color]],
    );
    const own = lines[color],
      enemy = lines[color === 'black' ? 'white' : 'black'];
    const wins = findWinningSquares(own, enemy);
    assert.deepEqual([...state.winning_squares(isBlack)], words(wins));
    assert.deepEqual(
      [...state.winning_squares(isBlack)],
      words(reference.winningSquareBitboards[color]),
    );
    assert.equal(
      state.has_immediate_threat(isBlack),
      reference.hasImmediateThreat(color),
    );
    if (allPatterns)
      for (let p = 0; p < 225; p++)
        for (let d = 0; d < 4; d++)
          assert.equal(
            state.analyze_pattern(p, d, isBlack),
            packed(analyzePackedLinePattern(own, enemy, p, d)),
          );
  }
  checks++;
}
for (const perspective of ['black', 'white'])
  for (const count of [0, 8, 64, 120, 200, 224]) {
    const order = shuffle(),
      b = new Uint32Array(8),
      w = new Uint32Array(8);
    for (let i = 0; i < count; i++)
      (i % 2 ? w : b)[order[i] >>> 5] |= 1 << (order[i] & 31);
    b[7] |= 0xfffffffe;
    w[7] |= 0xfffffffe;
    const originalB = b.slice(),
      originalW = w.slice();
    const state = new wasm.SearchState(b, w, perspective === 'black');
    const reference = createIncrementalEvaluator(b, w, perspective),
      frames = [];
    try {
      verify(state, reference, b, w, perspective, true);
      for (let i = count; i < Math.min(count + 80, 225); i++) {
        const p = order[i],
          black = i % 2 === 0,
          color = black ? 'black' : 'white';
        const token = state.make_move(p, black),
          jsToken = reference.makeMove(p, color);
        frames.push({ p, black, token, jsToken });
        (black ? b : w)[p >>> 5] |= 1 << (p & 31);
        verify(state, reference, b, w, perspective);
        const snapshot = {
          score: state.score(),
          lines: [...state.line_masks(true)],
          wins: [...state.winning_squares(true)],
          refs: [...state.winning_references(true)],
        };
        assert.throws(() => state.make_move(p, !black));
        assert.throws(() => state.make_move(225, black));
        if (frames.length > 1)
          assert.throws(() => state.undo_move(frames[0].token));
        assert.deepEqual(
          {
            score: state.score(),
            lines: [...state.line_masks(true)],
            wins: [...state.winning_squares(true)],
            refs: [...state.winning_references(true)],
          },
          snapshot,
        );
      }
      while (frames.length) {
        const { p, black, token, jsToken } = frames.pop();
        state.undo_move(token);
        reference.undoMove(jsToken);
        (black ? b : w)[p >>> 5] &= ~(1 << (p & 31));
        verify(state, reference, b, w, perspective);
      }
      assert.deepEqual(b, originalB);
      assert.deepEqual(w, originalW);
      assert.equal(state.history_length(), 0);
      assert.throws(() => state.undo_move(0));
      // Revisited branches cannot use stale tokens; getter results are detached copies.
      if (count < 225) {
        const p = order[count],
          old = state.make_move(p, true);
        state.undo_move(old);
        const next = state.make_move(p, true);
        assert.notEqual(old, next);
        assert.throws(() => state.undo_move(old));
        const copy = state.line_masks(true);
        copy.fill(0);
        assert.notDeepEqual([...state.line_masks(true)], [...copy]);
        state.undo_move(next);
      }
    } finally {
      state.free();
    }
  }
// Crossed four threats share a winning square. Undo removes only one reference.
const b = new Uint32Array(8);
for (const p of [108, 109, 110, 111, 52, 67, 82]) b[p >>> 5] |= 1 << (p & 31);
const state = new wasm.SearchState(b, new Uint32Array(8), true);
try {
  const token = state.make_move(97, true);
  assert.equal(state.winning_references(true)[112], 2);
  state.undo_move(token);
  assert.equal(state.winning_references(true)[112], 1);
  assert.ok(state.winning_squares(true)[3] & (1 << 16));
} finally {
  state.free();
}
// Every square independently checks exactly-four-line updates and all packed windows.
for (let p = 0; p < 225; p++) {
  const empty = new Uint32Array(8),
    state = new wasm.SearchState(empty, empty, true);
  try {
    const token = state.make_move(p, true);
    assert.equal([...state.line_masks(true)].filter(Boolean).length, 4);
    const b = empty.slice();
    b[p >>> 5] |= 1 << (p & 31);
    const lines = createLineBitboards(b, empty);
    for (let q = 0; q < 225; q++)
      for (let d = 0; d < 4; d++)
        assert.equal(
          state.analyze_pattern(q, d, true),
          packed(analyzePackedLinePattern(lines.black, lines.white, q, d)),
        );
    state.undo_move(token);
    assert.equal(state.score(), 0);
    assert.ok([...state.line_masks(true)].every((v) => v === 0));
  } finally {
    state.free();
  }
}
console.log(
  `Incremental Rust/Wasm parity passed: ${checks} state snapshots, four-line updates at all 225 squares, packed windows, cache crossings, make/undo, stale tokens, invalid moves and detached getters.`,
);

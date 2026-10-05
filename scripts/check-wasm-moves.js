import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { generateCandidateMoves } from '../src/ai/moves.js';
import { createIncrementalEvaluator } from '../src/ai/incremental-evaluation.js';
const wasm = createRequire(import.meta.url)(
  '../engine-rust/pkg/nodejs/gomoku_engine.js',
);
const decode = (packed) => {
  assert.equal(packed.length % 3, 0);
  const result = [];
  for (let i = 0; i < packed.length; i += 3) {
    const p = packed[i];
    result.push({
      row: Math.floor(p / 15),
      col: p % 15,
      position: p,
      priority: packed[i + 1],
      ...(packed[i + 2] < 0 ? {} : { tactical: packed[i + 2] }),
    });
  }
  return result;
};
const put = (board, p) => (board[p >>> 5] |= 1 << (p & 31));
let cases = 0,
  seed = 8721;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
function verify(b, w, state = null, reference = null) {
  const beforeB = b.slice(),
    beforeW = w.slice();
  for (const color of ['black', 'white']) {
    const expected = generateCandidateMoves(
      b,
      w,
      color,
      reference?.lineBitboards,
      reference?.winningSquareBitboards,
    );
    assert.deepEqual(
      decode(wasm.generate_candidates(b, w, color === 'black')),
      expected,
    );
    if (state)
      assert.deepEqual(decode(state.candidates(color === 'black')), expected);
    cases++;
  }
  assert.deepEqual(b, beforeB);
  assert.deepEqual(w, beforeW);
}
for (const count of [0, 1, 2, 3, 8, 9, 10, 24, 64, 120, 200, 224, 225])
  for (let sample = 0; sample < 12; sample++) {
    const b = new Uint32Array(8),
      w = new Uint32Array(8),
      order = Array.from({ length: 225 }, (_, i) => i);
    for (let i = 224; i > 0; i--) {
      const j = random() % (i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (let i = 0; i < count; i++) put(i % 2 ? b : w, order[i]);
    if (sample % 2 === 0) {
      b[7] |= 0xfffffffe;
      w[7] |= 0xfffffffe;
    }
    verify(b, w);
  }
// Every single-stone location checks edges, word boundaries and stable ties.
for (let p = 0; p < 225; p++) {
  const b = new Uint32Array(8),
    w = new Uint32Array(8);
  put(b, p);
  verify(b, w);
}
// Density threshold, tactical precedence, and dense crossing threats.
for (const [black, white] of [
  [[112, 113], []],
  [[112, 113, 127], []],
  [
    [108, 109, 110, 111],
    [153, 154, 155, 156],
  ],
  [
    Array.from({ length: 15 }, (_, r) => [
      r * 15 + 3,
      r * 15 + 4,
      r * 15 + 5,
      r * 15 + 6,
    ]).flat(),
    [],
  ],
  [
    [0, 1, 15, 16, 31, 32, 33, 47, 48],
    [2, 17, 34, 49, 64],
  ],
]) {
  const b = new Uint32Array(8),
    w = new Uint32Array(8);
  black.forEach((p) => put(b, p));
  white.forEach((p) => put(w, p));
  verify(b, w);
}
// Complete move lists remain identical with cached wins through make/undo.
for (let sample = 0; sample < 8; sample++) {
  const b = new Uint32Array(8),
    w = new Uint32Array(8),
    state = new wasm.SearchState(b, w, true),
    reference = createIncrementalEvaluator(b, w, 'black'),
    frames = [];
  try {
    verify(b, w, state, reference);
    for (let i = 0; i < 120; i++) {
      let p;
      do {
        p = random() % 225;
      } while ((b[p >>> 5] | w[p >>> 5]) & (1 << (p & 31)));
      const black = i % 2 === 0,
        token = state.make_move(p, black),
        jsToken = reference.makeMove(p, black ? 'black' : 'white');
      frames.push({ p, black, token, jsToken });
      put(black ? b : w, p);
      verify(b, w, state, reference);
    }
    while (frames.length) {
      const { p, black, token, jsToken } = frames.pop();
      state.undo_move(token);
      reference.undoMove(jsToken);
      (black ? b : w)[p >>> 5] &= ~(1 << (p & 31));
      verify(b, w, state, reference);
    }
  } finally {
    state.free();
  }
}
assert.throws(() =>
  wasm.generate_candidates(new Uint32Array(7), new Uint32Array(8), true),
);
console.log(
  `Candidate Rust/Wasm parity passed: ${cases} board/color cases, complete objects and ordering, standalone and cached paths, density thresholds, tactics, padding and make/undo.`,
);

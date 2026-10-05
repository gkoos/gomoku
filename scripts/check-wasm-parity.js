import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { analyzeLinePattern } from '../src/ai/patterns.js';
import { evaluatePosition } from '../src/ai/evaluation.js';
import {
  bitboardPositions,
  bitboardsFull,
  bitboardsOverlap,
} from '../src/core/bitboards.js';
const require = createRequire(import.meta.url);
const wasm = require('../engine-rust/pkg/nodejs/gomoku_engine.js');
const directions = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];
const unpack = (value) => ({
  stones: value & 255,
  windows: (value >>> 8) & 255,
  winningMoves: (value >>> 16) & 255,
  openThree: !!(value & (1 << 24)),
  openTwo: !!(value & (1 << 25)),
});
const put = (board, p) => {
  board[p >>> 5] |= 1 << (p & 31);
};
let patterns = 0;
// Exhaustive ternary nine-square windows, in every board direction.
for (let code = 0; code < 3 ** 9; code++) {
  let value = code,
    friendly = 0,
    blockers = 0;
  const digits = [];
  for (let i = 0; i < 9; i++) {
    const digit = value % 3;
    value = Math.floor(value / 3);
    digits.push(digit);
    if (digit === 1) friendly |= 1 << i;
    else if (digit === 2) blockers |= 1 << i;
  }
  for (const [direction, [dr, dc]] of directions.entries()) {
    const b = new Uint32Array(8),
      w = new Uint32Array(8);
    for (let i = 0; i < 9; i++) {
      const p = (7 + dr * (i - 4)) * 15 + 7 + dc * (i - 4);
      if (digits[i]) put(digits[i] === 1 ? b : w, p);
    }
    const expected = analyzeLinePattern(b, w, 7, 7, dr, dc);
    assert.deepEqual(
      unpack(wasm.classify_pattern(friendly, blockers)),
      expected,
    );
    assert.deepEqual(
      unpack(wasm.analyze_pattern(b, w, 112, direction)),
      expected,
    );
    patterns++;
  }
}
let seed = 1931,
  boards = 0;
for (const count of [0, 1, 8, 24, 64, 120, 224, 225]) {
  for (let sample = 0; sample < 8; sample++) {
    const b = new Uint32Array(8),
      w = new Uint32Array(8),
      positions = Array.from({ length: 225 }, (_, i) => i);
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
    for (let i = positions.length - 1; i > 0; i--) {
      const j = random() % (i + 1);
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }
    for (let i = 0; i < count; i++) put(i % 2 ? b : w, positions[i]);
    // Padding must have no effect, including simultaneous padding in both colors.
    b[7] |= 0xfffffffe;
    w[7] |= 0xfffffffe;
    for (const color of ['black', 'white'])
      assert.equal(
        wasm.evaluate_position(b, w, color === 'black'),
        evaluatePosition(b, w, color, color === 'black' ? 'white' : 'black'),
      );
    assert.deepEqual(
      [...wasm.occupied_positions(b, w)],
      [...bitboardPositions(b, w)],
    );
    assert.deepEqual(
      [...wasm.empty_positions(b, w)],
      [...bitboardPositions(b, w, true)],
    );
    assert.equal(wasm.boards_overlap(b, w), bitboardsOverlap(b, w));
    assert.equal(wasm.boards_full(b, w), bitboardsFull(b, w));
    for (let p = 0; p < 225; p++)
      for (const [direction, [dr, dc]] of directions.entries())
        assert.deepEqual(
          unpack(wasm.analyze_pattern(b, w, p, direction)),
          analyzeLinePattern(b, w, Math.floor(p / 15), p % 15, dr, dc),
        );
    boards++;
  }
}
// Invalid input and actual overlapping occupancy retain explicit behavior.
assert.throws(() =>
  wasm.evaluate_position(new Uint32Array(7), new Uint32Array(8), true),
);
assert.throws(() =>
  wasm.analyze_pattern(new Uint32Array(8), new Uint32Array(8), 225, 0),
);
assert.throws(() =>
  wasm.analyze_pattern(new Uint32Array(8), new Uint32Array(8), 0, 4),
);
const overlap = new Uint32Array(8);
put(overlap, 31);
assert.equal(wasm.boards_overlap(overlap, overlap), true);
for (const color of ['black', 'white'])
  assert.equal(
    wasm.evaluate_position(overlap, overlap, color === 'black'),
    evaluatePosition(
      overlap,
      overlap,
      color,
      color === 'black' ? 'white' : 'black',
    ),
  );
console.log(
  `Rust/Wasm parity passed: ${patterns} directional ternary patterns, ${boards} boards, all anchors and directions, both perspectives, padding and invalid inputs.`,
);

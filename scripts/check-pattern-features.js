import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { patternAt, patternCategory, PATTERN_FEATURES } from '../scripts/selfplay/pattern-features.js';

const wasm = createRequire(import.meta.url)('../engine-rust/pkg/nodejs/gomoku_engine.js');
const bits = (positions) => {
  const board = new Uint32Array(8);
  for (const p of positions) board[p >>> 5] |= 1 << (p & 31);
  return board;
};
const rustCategory = (packed) => {
  const stones = packed & 0xff,
    winningMoves = (packed >>> 16) & 0xff,
    openThree = ((packed >>> 24) & 1) === 1,
    openTwo = ((packed >>> 25) & 1) === 1;
  if (stones >= 5) return 0;
  if (stones === 4) return winningMoves >= 2 ? 1 : 2;
  if (stones === 3) return openThree ? 3 : 4;
  if (stones === 2) return openTwo ? 5 : 6;
  if (stones === 1) return 7;
  return -1;
};

let seed = 0x1a2b3c4d;
const random = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed >>> 0;
};
const positions = Array.from({ length: 225 }, (_, i) => i);

let cases = 0;
const verify = (blackPositions, whitePositions) => {
  const black = bits(blackPositions),
    white = bits(whitePositions);
  for (const position of positions)
    for (const direction of [0, 1, 2, 3]) {
      const js = patternCategory(patternAt(black, white, position, direction));
      const rust = rustCategory(wasm.analyze_pattern(black, white, position, direction));
      assert.equal(js, rust, `black pattern at ${position} dir ${direction}`);
      const jsWhite = patternCategory(patternAt(white, black, position, direction));
      const rustWhite = rustCategory(wasm.analyze_pattern(white, black, position, direction));
      assert.equal(jsWhite, rustWhite, `white pattern at ${position} dir ${direction}`);
      cases += 2;
    }
};
verify([], []);
for (let p = 0; p < 225; p += 11) verify([p], []);
for (const count of [2, 4, 9, 20, 60, 150]) {
  for (let sample = 0; sample < 8; sample++) {
    const order = positions.slice();
    for (let i = 224; i > 0; i--) {
      const j = random() % (i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    const black = [],
      white = [];
    for (let i = 0; i < count; i++) (i % 2 ? black : white).push(order[i]);
    verify(black, white);
  }
}
assert.equal(PATTERN_FEATURES, 65);
console.log(`Pattern feature parity passed: ${cases} category cases vs the Rust classifier.`);

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  patternAt,
  patternCategory,
  patternFeatures,
  PATTERN_FEATURES,
} from '../scripts/selfplay/pattern-features.js';

const bits = (positions) => {
  const board = new Uint32Array(8);
  for (const p of positions) board[p >>> 5] |= 1 << (p & 31);
  return board;
};

test('features are fixed-width, finite, and deterministic', () => {
  const black = bits([112, 113, 128]),
    white = bits([97, 98, 126]);
  const features = patternFeatures(black, white, 'black');
  assert.equal(features.length, PATTERN_FEATURES);
  assert.ok(features.every((value) => Number.isFinite(value) && value >= 0));
  assert.deepEqual(patternFeatures(black, white, 'black'), features);
  assert.deepEqual(patternFeatures(black, white, 'white'), patternFeatures(black, white, 'white'));
});

test('an open three is categorised and counted for the mover', () => {
  // Row 7, columns 6,7,8: a consecutive three with both ends open.
  const black = bits([111, 112, 113]);
  const white = bits([]);
  const pattern = patternAt(black, white, 112, 0); // direction (0,1) = along the row
  assert.equal(pattern.stones, 3);
  assert.equal(patternCategory(pattern), 3); // open three
  const features = patternFeatures(black, white, 'black');
  assert.ok(features[0 * 8 + 3] >= 1, 'open-three count present in direction 0');
});

test('a blocked line is not an open three', () => {
  const black = bits([111, 112, 113]);
  const white = bits([114]); // opponent stone blocks one end
  assert.notEqual(patternCategory(patternAt(black, white, 112, 0)), 3);
});

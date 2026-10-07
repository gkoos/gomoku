import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLineBitboards,
  findThreeCreationSquares,
  findDoubleThreatSquares,
} from '../src/ai/line-bitboards.js';

const empty = () => Array(8).fill(0);
const bits = (...positions) => {
  const b = empty();
  for (const p of positions) b[p >>> 5] |= 1 << (p & 31);
  return b;
};
const set = (board) => {
  const out = [];
  for (let word = 0; word < 8; word++) {
    let mask = word === 7 ? board[word] & 1 : board[word];
    while (mask) {
      out.push(word * 32 + 31 - Math.clz32(mask & -mask));
      mask &= mask - 1;
    }
  }
  return out;
};

test('three creation squares cover the ends of a clean three', () => {
  const black = bits(112, 113);
  const lines = createLineBitboards(black, empty());
  assert.deepEqual(
    set(findThreeCreationSquares(lines.black, lines.white)),
    [111, 114],
  );
  assert.deepEqual(set(findThreeCreationSquares(lines.white, lines.black)), []);
});

test('double three detected and single threes excluded', () => {
  const black = bits(112, 114, 98, 128);
  const lines = createLineBitboards(black, empty());
  assert.deepEqual(set(findDoubleThreatSquares(lines, 'black')), [113]);
  assert.deepEqual(lines, createLineBitboards(black, empty()));
});

test('four-three is a double threat and restores line state', () => {
  const black = bits(112, 113, 114, 100, 130);
  const white = bits(111);
  const lines = createLineBitboards(black, white);
  assert.deepEqual(set(findDoubleThreatSquares(lines, 'black')), [115]);
  assert.deepEqual(lines, createLineBitboards(black, white));
});

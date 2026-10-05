import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bitboardPositions,
  bitboardsOverlap,
  bitboardsFull,
} from '../src/core/bitboards.js';
import {
  getBitboardResult,
  checkWinCondition,
  findLegalFallback,
} from '../src/core/rules.js';
import { createPositionHasher } from '../src/ai/zobrist.js';

function reference(b, w) {
  const winners = new Set();
  let full = true;
  for (let p = 0; p < 225; p++) {
    const mask = 1 << (p & 31),
      word = p >>> 5;
    const black = !!(b[word] & mask),
      white = !!(w[word] & mask);
    if (black && white) return { invalid: true };
    if (!black && !white) full = false;
    if (black && checkWinCondition(b, p)) winners.add('black');
    if (white && checkWinCondition(w, p)) winners.add('white');
  }
  if (winners.size > 1) return { invalid: true };
  if (winners.size) return { winner: [...winners][0] };
  return full ? { draw: true } : null;
}

test('word operations match square scans, including signed words and padding', () => {
  let seed = 917;
  for (let sample = 0; sample < 100; sample++) {
    const b = Array(8).fill(0),
      w = Array(8).fill(0);
    for (let p = 0; p < 225; p++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const color = seed % 5;
      if (color === 0 || color === 2) b[p >>> 5] |= 1 << (p & 31);
      if (color === 1 || color === 2) w[p >>> 5] |= 1 << (p & 31);
    }
    b[7] |= -2;
    w[7] |= -2;
    const occupied = [],
      empty = [];
    let overlap = false;
    for (let p = 0; p < 225; p++) {
      const m = 1 << (p & 31),
        i = p >>> 5;
      ((b[i] | w[i]) & m ? occupied : empty).push(p);
      overlap ||= !!(b[i] & w[i] & m);
    }
    assert.deepEqual([...bitboardPositions(b, w)], occupied);
    assert.deepEqual([...bitboardPositions(b, w, true)], empty);
    assert.equal(bitboardsOverlap(b, w), overlap);
    assert.equal(bitboardsFull(b, w), empty.length === 0);
    assert.deepEqual(getBitboardResult(b, w), reference(b, w));
  }
});

test('fallback preserves first legal square and rejects terminal positions', () => {
  for (const p of [0, 31, 32, 63, 64, 223, 224]) {
    const b = Array(8).fill(0),
      w = Array(8).fill(0);
    // A draw pattern with no five-in-a-row in any direction.
    for (let q = 0; q < 225; q++) {
      if (q === p) continue;
      const row = Math.floor(q / 15),
        col = q % 15;
      ((row + Math.floor(col / 2)) % 2 ? b : w)[q >>> 5] |= 1 << (q & 31);
    }
    assert.equal(getBitboardResult(b, w), null);
    assert.deepEqual(findLegalFallback(b, w), {
      row: Math.floor(p / 15),
      col: p % 15,
    });
    b[p >>> 5] |= 1 << (p & 31);
    assert.equal(findLegalFallback(b, w), null);
  }
});

test('initial hashes equal incremental hashes and ignore padding bits', () => {
  for (const color of ['black', 'white']) {
    const b = Array(8).fill(0),
      w = Array(8).fill(0);
    const h = createPositionHasher(b, w, color);
    for (const [i, p] of [0, 31, 32, 63, 64, 127, 191, 223, 224].entries()) {
      const stone = i % 2 ? 'white' : 'black';
      (stone === 'black' ? b : w)[p >>> 5] |= 1 << (p & 31);
      h.toggleMove(p, stone);
      assert.equal(h.key, createPositionHasher(b, w, h.toMove).key);
    }
    b[7] |= -2;
    w[7] |= -2;
    assert.equal(h.key, createPositionHasher(b, w, h.toMove).key);
  }
});

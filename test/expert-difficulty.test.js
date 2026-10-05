import test from 'node:test';
import assert from 'node:assert/strict';
import { findBestMoveAdaptive } from '../src/ai/engine.js';

test('Expert completes ten iterative depths while existing levels retain their caps', () => {
  const b = Array(8).fill(0),
    w = Array(8).fill(0);
  // One empty square in a draw pattern keeps every search depth cheap.
  for (let p = 0; p < 225; p++) {
    if (p === 224) continue;
    const row = Math.floor(p / 15),
      col = p % 15;
    ((row + Math.floor(col / 2)) % 2 ? b : w)[p >>> 5] |= 1 << (p & 31);
  }
  for (const [difficulty, cap] of [
    ['medium', 6],
    ['hard', 8],
    ['expert', 10],
  ]) {
    const iterations = [];
    const move = findBestMoveAdaptive(
      b,
      w,
      'black',
      'white',
      difficulty,
      () => {},
      { onIteration: (result) => iterations.push(result) },
    );
    assert.deepEqual({ row: move.row, col: move.col }, { row: 14, col: 14 });
    assert.deepEqual(
      iterations.map((result) => result.depth),
      Array.from({ length: cap }, (_, i) => i + 1),
    );
    assert.ok(
      iterations.every(
        (result) => result.move.row === 14 && result.move.col === 14,
      ),
    );
  }
});

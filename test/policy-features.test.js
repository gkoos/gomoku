import test from 'node:test';
import assert from 'node:assert/strict';

import {
  boardCells,
  neighborhoodDensity,
  candidateFeatures,
  POLICY_FEATURES,
} from '../src/ai/policy.js';

const put = (board, ...positions) => {
  for (const p of positions) board[p >>> 5] |= 1 << (p & 31);
};

test('board cells and density decode both colours and edges', () => {
  const black = new Uint32Array(8),
    white = new Uint32Array(8);
  put(black, 0, 112);
  put(white, 224);
  const cells = boardCells(black, white);
  assert.equal(cells[0], 1);
  assert.equal(cells[112], 1);
  assert.equal(cells[224], 2);
  assert.equal(cells.filter(Boolean).length, 3);
  const density = neighborhoodDensity(cells);
  assert.equal(density[50], 0);
  assert.equal(density[112], 1);
  assert.equal(density[97], 1);
  assert.equal(density[113], 1);
  assert.equal(density[126], 1);
  assert.equal(density[224], 1);
});

test('features are fixed-width, finite, bounded, and deterministic', () => {
  const black = new Uint32Array(8),
    white = new Uint32Array(8);
  put(black, 112, 113);
  put(white, 97, 98);
  const cells = boardCells(black, white);
  const density = neighborhoodDensity(cells);
  const options = { priority: 940, density: density[99], tactical: 0, ply: 4 };
  const features = candidateFeatures(cells, 99, 'black', options);
  assert.equal(features.length, POLICY_FEATURES);
  assert.ok(features.every((v) => Number.isFinite(v) && v >= 0 && v <= 1));
  assert.deepEqual(candidateFeatures(cells, 99, 'black', options), features);
});

test('own-run length grows when the candidate extends a line', () => {
  const black = new Uint32Array(8),
    white = new Uint32Array(8);
  put(black, 0, 1);
  const cells = boardCells(black, white);
  const density = neighborhoodDensity(cells);
  // Right direction is the second block (offset 5 + 5); its own-run feature is first.
  const isolated = candidateFeatures(cells, 200, 'black', { priority: 100, density: density[200], tactical: 0, ply: 2 });
  const extending = candidateFeatures(cells, 2, 'black', { priority: 100, density: density[2], tactical: 0, ply: 2 });
  assert.equal(isolated[10], 1 / 5);
  assert.ok(Math.abs(extending[10] - 3 / 5) < 1e-9);
  assert.ok(extending[10] > isolated[10]);
});

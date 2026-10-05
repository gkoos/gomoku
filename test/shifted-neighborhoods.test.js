import assert from 'node:assert/strict';
import test from 'node:test';
import { generateCandidateMoves } from '../src/ai/moves.js';
import { checkWinCondition } from '../src/core/rules.js';

// Independent reference: visit sources and offsets in the original order,
// compute density by direct counting, and upgrade duplicate priorities.
function reference(black, white, color) {
  const stones = [],
    candidates = [],
    visited = new Map();
  const empty = (r, c) =>
    r >= 0 &&
    r < 15 &&
    c >= 0 &&
    c < 15 &&
    !(
      (black[(r * 15 + c) >>> 5] | white[(r * 15 + c) >>> 5]) &
      (1 << ((r * 15 + c) & 31))
    );
  for (let p = 0; p < 225; p++)
    if ((black[p >>> 5] | white[p >>> 5]) & (1 << (p & 31)))
      stones.push([Math.floor(p / 15), p % 15]);
  function add(row, col, priority) {
    if (!empty(row, col)) return;
    const position = row * 15 + col;
    const old = visited.get(position);
    if (old) old.priority = Math.max(old.priority, priority);
    else {
      const move = { row, col, position, priority };
      visited.set(position, move);
      candidates.push(move);
    }
  }
  if (!stones.length) {
    for (const [r, c, p] of [
      [7, 7, 1000],
      [6, 6, 900],
      [6, 7, 950],
      [6, 8, 900],
      [7, 6, 950],
      [7, 8, 950],
      [8, 6, 900],
      [8, 7, 950],
      [8, 8, 900],
    ])
      add(r, c, p);
    return candidates.sort((a, b) => b.priority - a.priority);
  }
  const density = (r, c) =>
    stones.filter(([sr, sc]) => Math.abs(sr - r) <= 2 && Math.abs(sc - c) <= 2)
      .length;
  const center = (r, c) => 14 - Math.abs(r - 7) - Math.abs(c - 7);
  for (const [r, c] of stones) {
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++)
        if (dr || dc)
          add(
            r + dr,
            c + dc,
            100 + density(r + dr, c + dc) * 20 + center(r + dr, c + dc),
          );
    const local = density(r, c);
    if (local >= 3)
      for (let dr = -2; dr <= 2; dr++)
        for (let dc = -2; dc <= 2; dc++)
          if (Math.abs(dr) > 1 || Math.abs(dc) > 1)
            add(r + dr, c + dc, 30 + local * 5 + center(r + dr, c + dc));
  }
  let tacticalCount = 0;
  for (const move of candidates) {
    const b = [...black],
      w = [...white];
    b[move.position >>> 5] |= 1 << (move.position & 31);
    w[move.position >>> 5] |= 1 << (move.position & 31);
    const own = checkWinCondition(color === 'black' ? b : w, move.position),
      other = checkWinCondition(color === 'black' ? w : b, move.position);
    move.tactical = own ? 2 : other ? 1 : 0;
    if (move.tactical) tacticalCount++;
  }
  return candidates
    .sort((a, b) => b.tactical - a.tactical || b.priority - a.priority)
    .slice(0, Math.max(stones.length < 10 ? 30 : 50, tacticalCount));
}
function compare(b, w) {
  const before = structuredClone([b, w]);
  for (const color of ['black', 'white'])
    assert.deepEqual(
      generateCandidateMoves(b, w, color),
      reference(b, w, color),
    );
  assert.deepEqual([b, w], before);
}
function put(board, p) {
  board[p >>> 5] |= 1 << (p & 31);
}

test('shifted neighborhoods preserve reference priorities and tie ordering on sparse and dense boards', () => {
  let seed = 1618033;
  for (const count of [0, 1, 2, 3, 8, 24, 64, 120, 224, 225])
    for (let sample = 0; sample < 12; sample++) {
      const b = Array(8).fill(0),
        w = Array(8).fill(0),
        used = new Set();
      while (used.size < count) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const p = seed % 225;
        if (used.has(p)) continue;
        used.add(p);
        put(used.size % 2 ? b : w, p);
      }
      compare(b, w);
    }
});

test('single-stone frontiers stay inside the board at every square', () => {
  for (let p = 0; p < 225; p++) {
    const b = Array(8).fill(0),
      w = Array(8).fill(0);
    put(b, p);
    compare(b, w);
  }
});

test('distance-two expansion activates only for locally dense source stones', () => {
  const b = Array(8).fill(0),
    w = Array(8).fill(0);
  put(b, 112);
  put(w, 113);
  assert.equal(
    generateCandidateMoves(b, w).some((m) => m.position === 110),
    false,
  );
  put(b, 127);
  assert.equal(
    generateCandidateMoves(b, w).some((m) => m.position === 110),
    true,
  );
  compare(b, w);
});

test('priority upgrades keep the earliest source ordering across crowded corners and reflected boards', () => {
  for (const transform of [
    (r, c) => [r, c],
    (r, c) => [14 - r, c],
    (r, c) => [r, 14 - c],
    (r, c) => [14 - r, 14 - c],
  ]) {
    const b = Array(8).fill(0),
      w = Array(8).fill(0);
    for (let r = 0; r < 6; r++)
      for (let c = 0; c < 6; c++)
        if ((r + c) % 3 !== 0) {
          const [row, col] = transform(r, c);
          put((r + c) % 2 ? b : w, row * 15 + col);
        }
    compare(b, w);
  }
});

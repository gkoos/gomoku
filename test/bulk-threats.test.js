import assert from 'node:assert/strict';
import test from 'node:test';
import { checkWinCondition } from '../src/core/rules.js';
import {
  checkImmediateThreat,
  checkOpen4Threats,
  hasOpen4PatternSimple,
} from '../src/ai/threats.js';
import {
  createLineBitboards,
  findWinningSquares,
  findOpenFourSquares,
  threatMovesFromBitboard,
} from '../src/ai/line-bitboards.js';

const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];
function put(board, position) {
  board[position >>> 5] |= 1 << (position & 31);
}
function reference(black, white, color, open = false) {
  const player = color === 'black' ? black : white,
    result = [];
  for (let position = 0; position < 225; position++) {
    const slot = position >>> 5,
      bit = 1 << (position & 31);
    if ((black[slot] | white[slot]) & bit) continue;
    const row = Math.floor(position / 15),
      col = position % 15;
    let found;
    if (open)
      found = DIRECTIONS.some(([dr, dc]) =>
        hasOpen4PatternSimple(player, black, white, row, col, dr, dc),
      );
    else {
      const placed = [...player];
      placed[slot] |= bit;
      found = checkWinCondition(placed, position);
    }
    if (found)
      result.push({ row, col, position, priority: open ? 'open4' : 'win' });
  }
  return result;
}
function compare(black, white) {
  const before = structuredClone([black, white]);
  const packed = createLineBitboards(black, white);
  for (const color of ['black', 'white']) {
    const own = color === 'black' ? packed.black : packed.white,
      opponent = color === 'black' ? packed.white : packed.black;
    const wins = reference(black, white, color),
      open = reference(black, white, color, true);
    assert.deepEqual(checkImmediateThreat(black, white, color), wins);
    assert.deepEqual(checkOpen4Threats(black, white, color), open);
    assert.deepEqual(
      threatMovesFromBitboard(findWinningSquares(own, opponent), 'win'),
      wins,
    );
    assert.deepEqual(
      threatMovesFromBitboard(findOpenFourSquares(own, opponent), 'open4'),
      open,
    );
  }
  assert.deepEqual([black, white], before);
}

for (const [dr, dc, row, col] of [
  [0, 1, 2, 0],
  [1, 0, 0, 1],
  [1, 1, 0, 0],
  [1, -1, 0, 14],
]) {
  test(
    'bulk detectors match every six-cell configuration in direction ' +
      dr +
      ',' +
      dc,
    () => {
      for (let code = 0; code < 3 ** 6; code++) {
        let state = code;
        const black = Array(8).fill(0),
          white = Array(8).fill(0);
        for (let i = 0; i < 6; i++) {
          const cell = state % 3;
          state = Math.floor(state / 3);
          if (cell)
            put(cell === 1 ? black : white, (row + dr * i) * 15 + col + dc * i);
        }
        compare(black, white);
      }
    },
  );
}

test('bulk detectors preserve random-board outputs, signed words and occupied endpoints', () => {
  let seed = 123456;
  for (const stones of [0, 1, 8, 24, 64, 120, 224, 225])
    for (let sample = 0; sample < 10; sample++) {
      const black = Array(8).fill(0),
        white = Array(8).fill(0),
        used = new Set();
      while (used.size < stones) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const position = seed % 225;
        if (used.has(position)) continue;
        used.add(position);
        put(used.size % 2 ? black : white, position);
      }
      compare(black, white);
    }
});

test('bulk geometry neither wraps rows nor accepts padding bits outside the board', () => {
  const black = Array(8).fill(0),
    white = Array(8).fill(0);
  for (const position of [
    13, 14, 15, 16, 31, 32, 63, 64, 95, 96, 127, 128, 159, 160, 191, 192, 223,
    224,
  ])
    put(black, position);
  compare(black, white);
  const validWins = checkImmediateThreat(black, white, 'black'),
    validOpen = checkOpen4Threats(black, white, 'black');
  black[7] |= 0xfffffffe;
  white[7] |= 0xfffffffe;
  assert.deepEqual(checkImmediateThreat(black, white, 'black'), validWins);
  assert.deepEqual(checkOpen4Threats(black, white, 'black'), validOpen);
});

test('crossing lines deduplicate winning squares and retain row-major ordering', () => {
  const black = Array(8).fill(0),
    white = Array(8).fill(0);
  for (const [r, c] of [
    [7, 3],
    [7, 4],
    [7, 5],
    [7, 6],
    [3, 7],
    [4, 7],
    [5, 7],
    [6, 7],
  ])
    put(black, r * 15 + c);
  compare(black, white);
  const wins = checkImmediateThreat(black, white, 'black');
  assert.equal(wins.filter((move) => move.position === 112).length, 1);
  assert.deepEqual(
    wins.map((move) => move.position),
    wins.map((move) => move.position).sort((a, b) => a - b),
  );
});

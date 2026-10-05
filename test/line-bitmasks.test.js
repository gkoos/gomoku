import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeLinePattern } from '../src/ai/patterns.js';

// Frozen array/window implementation, independent of the bitmask classifier.
const BOARD_SIZE = 15;

function referenceOpenFormation(cells, stoneCount) {
  for (let start = 0; start <= 3; start++) {
    if (cells[start] !== 0 || cells[start + 5] !== 0) continue;
    if (4 < start + 1 || 4 > start + 4) continue;
    let stones = 0;
    let blocked = false;
    for (let index = start + 1; index < start + 5; index++) {
      if (cells[index] === -1) {
        blocked = true;
        break;
      }
      stones += cells[index];
    }
    if (!blocked && stones === stoneCount) return true;
  }
  return false;
}

function referenceAnalyze(
  playerBitboard,
  opponentBitboard,
  row,
  col,
  dRow,
  dCol,
) {
  const cells = [];
  for (let offset = -4; offset <= 4; offset++) {
    const r = row + dRow * offset;
    const c = col + dCol * offset;
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) {
      cells.push(-1);
      continue;
    }
    const position = r * BOARD_SIZE + c;
    const slot = Math.floor(position / 32);
    const mask = 1 << (position % 32);
    cells.push(
      (opponentBitboard[slot] & mask) !== 0
        ? -1
        : (playerBitboard[slot] & mask) !== 0
          ? 1
          : 0,
    );
  }

  let stones = 0;
  let windows = 0;
  const winningSquares = new Set();
  for (let start = 0; start <= 4; start++) {
    let count = 0;
    let emptySquare = -1;
    let blocked = false;
    for (let index = start; index < start + 5; index++) {
      if (cells[index] === -1) {
        blocked = true;
        break;
      }
      if (cells[index] === 1) count++;
      else emptySquare = index;
    }
    if (blocked) continue;
    if (count > stones) {
      stones = count;
      windows = 1;
    } else if (count === stones) {
      windows++;
    }
    if (count === 4) winningSquares.add(emptySquare);
  }
  return {
    stones,
    windows,
    winningMoves: winningSquares.size,
    openThree: stones === 3 && referenceOpenFormation(cells, 3),
    openTwo: stones === 2 && referenceOpenFormation(cells, 2),
  };
}

const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

function lineBoards(code, row, col, dr, dc) {
  const player = Array(8).fill(0),
    opponent = Array(8).fill(0);
  for (let offset = -4; offset <= 4; offset++) {
    const value = code % 3;
    code = Math.floor(code / 3);
    const r = row + dr * offset,
      c = col + dc * offset;
    if (value === 0 || r < 0 || r >= 15 || c < 0 || c >= 15) continue;
    const position = r * 15 + c;
    (value === 1 ? player : opponent)[position >>> 5] |= 1 << (position & 31);
  }
  return [player, opponent];
}

for (const [dr, dc] of DIRECTIONS) {
  test(
    'bitmask patterns match all 19,683 line states in direction ' +
      dr +
      ',' +
      dc,
    () => {
      for (let code = 0; code < 3 ** 9; code++) {
        const [player, opponent] = lineBoards(code, 7, 7, dr, dc);
        assert.deepEqual(
          analyzeLinePattern(player, opponent, 7, 7, dr, dc),
          referenceAnalyze(player, opponent, 7, 7, dr, dc),
          'line configuration ' + code,
        );
      }
    },
  );
}

test('bitmask extraction matches the reference at edges and signed word boundaries', () => {
  let seed = 314159;
  for (const position of [
    0, 14, 15, 31, 32, 63, 64, 95, 96, 127, 128, 159, 160, 191, 192, 223, 224,
  ]) {
    const row = Math.floor(position / 15),
      col = position % 15;
    for (const [dr, dc] of DIRECTIONS) {
      for (let sample = 0; sample < 100; sample++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const [player, opponent] = lineBoards(seed % 3 ** 9, row, col, dr, dc);
        const snapshot = [player.slice(), opponent.slice()];
        for (const [own, other] of [
          [player, opponent],
          [opponent, player],
        ]) {
          assert.deepEqual(
            analyzeLinePattern(own, other, row, col, dr, dc),
            referenceAnalyze(own, other, row, col, dr, dc),
          );
        }
        assert.deepEqual([player, opponent], snapshot);
      }
    }
  }
});

import { BOARD_SIZE } from '../core/constants.js';

export function hasOpenFormation(cells, stoneCount) {
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

export function analyzeLinePattern(
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
    openThree: stones === 3 && hasOpenFormation(cells, 3),
    openTwo: stones === 2 && hasOpenFormation(cells, 2),
  };
}

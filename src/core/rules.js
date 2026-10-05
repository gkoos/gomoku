import { BOARD_SIZE, BOARD_CELLS } from './constants.js';

export function checkWinCondition(bitboard, lastPosition) {
  const row = Math.floor(lastPosition / BOARD_SIZE);
  const col = lastPosition % BOARD_SIZE;

  const directions = [
    [0, 1], // horizontal
    [1, 0], // vertical
    [1, 1], // diagonal \
    [1, -1], // diagonal /
  ];

  for (const [dRow, dCol] of directions) {
    let count = 1; // Count the stone we just placed

    // Check in positive direction
    for (let i = 1; i < 5; i++) {
      const newRow = row + dRow * i;
      const newCol = col + dCol * i;

      if (
        newRow < 0 ||
        newRow >= BOARD_SIZE ||
        newCol < 0 ||
        newCol >= BOARD_SIZE
      )
        break;

      const pos = newRow * BOARD_SIZE + newCol;
      const slot = Math.floor(pos / 32);
      const bit = pos % 32;

      if (slot < 8 && ((bitboard[slot] >>> 0) & (1 << bit)) !== 0) {
        count++;
      } else {
        break;
      }
    }

    // Check in negative direction
    for (let i = 1; i < 5; i++) {
      const newRow = row - dRow * i;
      const newCol = col - dCol * i;

      if (
        newRow < 0 ||
        newRow >= BOARD_SIZE ||
        newCol < 0 ||
        newCol >= BOARD_SIZE
      )
        break;

      const pos = newRow * BOARD_SIZE + newCol;
      const slot = Math.floor(pos / 32);
      const bit = pos % 32;

      if (slot < 8 && ((bitboard[slot] >>> 0) & (1 << bit)) !== 0) {
        count++;
      } else {
        break;
      }
    }

    if (count >= 5) {
      return true;
    }
  }

  return false;
}

export function getBitboardResult(blackBitboard, whiteBitboard) {
  const winners = new Set();
  let emptyCells = 0;
  for (let position = 0; position < BOARD_CELLS; position++) {
    const slot = Math.floor(position / 32);
    const mask = 1 << (position % 32);
    const black = (blackBitboard[slot] & mask) !== 0;
    const white = (whiteBitboard[slot] & mask) !== 0;
    if (black && white) return { invalid: true };
    if (!black && !white) {
      emptyCells++;
      continue;
    }
    const player = black ? 'black' : 'white';
    if (
      !winners.has(player) &&
      checkWinCondition(black ? blackBitboard : whiteBitboard, position)
    ) {
      winners.add(player);
    }
  }
  if (winners.size > 1) return { invalid: true };
  if (winners.size === 1) return { winner: winners.values().next().value };
  return emptyCells === 0 ? { draw: true } : null;
}

export function findLegalFallback(blackBitboard, whiteBitboard) {
  if (
    !blackBitboard ||
    !whiteBitboard ||
    getBitboardResult(blackBitboard, whiteBitboard)
  )
    return null;
  for (let position = 0; position < BOARD_CELLS; position++) {
    const slot = Math.floor(position / 32);
    const mask = 1 << (position % 32);
    if (((blackBitboard[slot] | whiteBitboard[slot]) & mask) === 0) {
      return {
        row: Math.floor(position / BOARD_SIZE),
        col: position % BOARD_SIZE,
      };
    }
  }
  return null;
}
export function getWinningLine(board, row, col) {
  const player = board[row]?.[col];
  if (!player) return null;
  for (const [dRow, dCol] of [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ]) {
    const positions = [[row, col]];
    for (const sign of [-1, 1]) {
      for (let step = 1; step < BOARD_SIZE; step++) {
        const r = row + sign * dRow * step;
        const c = col + sign * dCol * step;
        if (
          r < 0 ||
          r >= BOARD_SIZE ||
          c < 0 ||
          c >= BOARD_SIZE ||
          board[r][c] !== player
        )
          break;
        if (sign < 0) positions.unshift([r, c]);
        else positions.push([r, c]);
      }
    }
    if (positions.length >= 5) return positions.slice(0, 5);
  }
  return null;
}

export function getBoardResult(board) {
  if (
    board.length !== BOARD_SIZE ||
    board.some((row) => row.length !== BOARD_SIZE)
  ) {
    return { invalid: true };
  }
  const winners = new Map();
  let emptyCells = 0;
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const player = board[row][col];
      if (player === null) {
        emptyCells++;
      } else if (player !== 'black' && player !== 'white') {
        return { invalid: true };
      } else if (!winners.has(player)) {
        const line = getWinningLine(board, row, col);
        if (line) winners.set(player, line);
      }
    }
  }
  if (winners.size > 1) return { invalid: true };
  if (winners.size === 1) {
    const [winner, winningPositions] = winners.entries().next().value;
    return { winner, winningPositions };
  }
  return emptyCells === 0 ? { draw: true } : null;
}

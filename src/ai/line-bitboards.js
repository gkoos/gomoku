import { BOARD_SIZE, BOARD_CELLS } from '../core/constants.js';

// Every row, column and diagonal fits in a 15-bit word. Geometry is shared;
// search maintains these masks alongside its occupancy bitboards.
const LINES = [];
const MEMBERSHIPS = Array.from({ length: BOARD_CELLS }, () => []);
const WINDOWS = new Array(BOARD_CELLS * 4);
let direction = 0;
for (const [dr, dc] of [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
]) {
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const previousRow = row - dr,
        previousCol = col - dc;
      if (
        previousRow >= 0 &&
        previousRow < BOARD_SIZE &&
        previousCol >= 0 &&
        previousCol < BOARD_SIZE
      )
        continue;
      const cells = [];
      for (
        let r = row, c = col;
        r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
        r += dr, c += dc
      ) {
        const position = r * BOARD_SIZE + c;
        MEMBERSHIPS[position].push([LINES.length, 1 << cells.length]);
        cells.push(position);
      }
      LINES.push(cells);
      const valid = (1 << cells.length) - 1;
      for (let index = 0; index < cells.length; index++) {
        const shift = index - 4;
        const window = (shift >= 0 ? valid >>> shift : valid << -shift) & 511;
        WINDOWS[cells[index] * 4 + direction] = {
          line: LINES.length - 1,
          shift,
          borders: 511 & ~window,
        };
      }
    }
  }
  direction++;
}

export function getLineWindow(position, direction) {
  return WINDOWS[position * 4 + direction];
}

export function updateLineBitboards(lines, position, color, occupied) {
  const board = lines[color];
  for (const [line, bit] of MEMBERSHIPS[position]) {
    if (occupied) board[line] |= bit;
    else board[line] &= ~bit;
  }
}

export function createLineBitboards(black, white) {
  const result = {
    black: new Uint16Array(LINES.length),
    white: new Uint16Array(LINES.length),
  };
  for (const [board, packed] of [
    [black, result.black],
    [white, result.white],
  ]) {
    for (let slot = 0; slot < 8; slot++) {
      let mask = board[slot];
      if (slot === 7) mask &= 1; // Only position 224 belongs to the board.
      while (mask) {
        const position = slot * 32 + 31 - Math.clz32(mask & -mask);
        for (const [line, bit] of MEMBERSHIPS[position]) packed[line] |= bit;
        mask &= mask - 1;
      }
    }
  }
  return result;
}

function winningLineSquares(stones, opponent, length) {
  const empty = ~(stones | opponent) & ((1 << length) - 1);
  const fours = stones & (stones >>> 1) & (stones >>> 2) & (stones >>> 3);
  // End extensions and the three possible interior gaps in a five-cell run.
  return (
    empty &
    ((fours << 4) |
      (fours >>> 1) |
      ((stones << 1) & (stones >>> 1) & (stones >>> 2) & (stones >>> 3)) |
      ((stones << 1) & (stones << 2) & (stones >>> 1) & (stones >>> 2)) |
      ((stones << 1) & (stones << 2) & (stones << 3) & (stones >>> 1)))
  );
}

function openFourLineSquares(stones, opponent, length) {
  if (length < 6) return 0;
  const empty = ~(stones | opponent) & ((1 << length) - 1);
  const openEnds = empty & (empty >>> 5) & ((1 << (length - 5)) - 1);
  let squares = 0;
  // A six-cell window has empty ends, three stones and one interior move.
  for (let gap = 1; gap <= 4; gap++) {
    let starts = openEnds & (empty >>> gap);
    for (let stone = 1; stone <= 4; stone++)
      if (stone !== gap) starts &= stones >>> stone;
    squares |= starts << gap;
  }
  return squares;
}

function collectSquares(own, opponent, classify) {
  const result = Array(8).fill(0);
  for (let line = 0; line < LINES.length; line++) {
    const cells = LINES[line];
    if (cells.length < 5) continue;
    let squares = classify(own[line], opponent[line], cells.length);
    while (squares) {
      const position = cells[31 - Math.clz32(squares & -squares)];
      result[position >>> 5] |= 1 << (position & 31);
      squares &= squares - 1;
    }
  }
  return result;
}

export function findWinningSquares(own, opponent) {
  return collectSquares(own, opponent, winningLineSquares);
}

export function findOpenFourSquares(own, opponent) {
  return collectSquares(own, opponent, openFourLineSquares);
}

export function threatMovesFromBitboard(bitboard, priority) {
  const moves = [];
  // Ascending set-bit order preserves the original row-major threat ordering.
  for (let slot = 0; slot < bitboard.length; slot++) {
    let mask = bitboard[slot];
    while (mask) {
      const position = slot * 32 + 31 - Math.clz32(mask & -mask);
      moves.push({
        row: Math.floor(position / BOARD_SIZE),
        col: position % BOARD_SIZE,
        position,
        priority,
      });
      mask &= mask - 1;
    }
  }
  return moves;
}

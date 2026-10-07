import { BOARD_SIZE, BOARD_CELLS } from '../core/constants.js';
import { bitboardPositions } from '../core/bitboards.js';

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
  let fourth = stones & (stones - 1);
  fourth &= fourth - 1;
  fourth &= fourth - 1;
  if (!fourth) return 0;
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

export function findFourCreationSquares(own, opponent) {
  return collectSquares(own, opponent, (stones, blockers, length) => {
    let result = 0;
    for (let start = 0; start <= length - 5; start++) {
      const friendly = (stones >>> start) & 31;
      if ((blockers >>> start) & 31) continue;
      let mask = friendly, count = 0;
      while (mask) { count++; mask &= mask - 1; }
      if (count === 3) result |= (~friendly & 31) << start;
    }
    return result;
  });
}

function popcount(value) {
  let count = 0;
  while (value) {
    count++;
    value &= value - 1;
  }
  return count;
}

// Does placing a stone at `bit` create a clean open three through that square?
// A clean open three is three consecutive friendly stones with both ends empty;
// broken/jump threes such as `_XX_X_` are excluded.
function openThreeAt(own, opponent, length, bit) {
  if (length < 6) return false;
  for (let start = 0; start <= length - 6; start++) {
    const interior = 0b1111 << (start + 1);
    if ((interior & bit) === 0) continue;
    if (interior & opponent) continue;
    const ends = (1 << start) | (1 << (start + 5));
    if ((own | opponent) & ends) continue;
    const stones = (own | bit) & interior;
    if (stones === (0b0111 << (start + 1)) || stones === (0b1110 << (start + 1))) return true;
  }
  return false;
}

// Does `position` (already placed for `color`) participate in a clean
// consecutive open three in `direction`? Broken/jump threes are excluded.
export function isCleanThree(lines, color, position, direction) {
  const [line, bit] = MEMBERSHIPS[position][direction];
  const length = LINES[line].length;
  if (length < 6) return false;
  const other = color === 'black' ? 'white' : 'black';
  const own = lines[color][line];
  const enemy = lines[other][line];
  for (let start = 0; start <= length - 6; start++) {
    const interior = 0b1111 << (start + 1);
    if ((interior & bit) === 0) continue;
    if (interior & enemy) continue;
    const ends = (1 << start) | (1 << (start + 5));
    if ((own | enemy) & ends) continue;
    const stones = own & interior;
    if (stones === (0b0111 << (start + 1)) || stones === (0b1110 << (start + 1))) return true;
  }
  return false;
}

// Every move that creates an open three for the given side.
export function findThreeCreationSquares(own, opponent) {
  const result = Array(8).fill(0);
  for (let line = 0; line < LINES.length; line++) {
    const cells = LINES[line];
    const length = cells.length;
    if (length < 6) continue;
    let mask = ~(own[line] | opponent[line]) & ((1 << length) - 1);
    while (mask) {
      const bit = mask & -mask;
      if (openThreeAt(own[line], opponent[line], length, bit)) {
        const position = cells[31 - Math.clz32(bit)];
        result[position >>> 5] |= 1 << (position & 31);
      }
      mask &= mask - 1;
    }
  }
  return result;
}

// Every move that creates an unanswerable threat for `color`: two or more
// winning squares, a four plus an open three on another line, or two open
// threes on distinct lines.
export function findDoubleThreatSquares(lines, color) {
  const other = color === 'black' ? 'white' : 'black';
  const fours = findFourCreationSquares(lines[color], lines[other]);
  const threes = findThreeCreationSquares(lines[color], lines[other]);
  const candidates = fours.map((word, i) => word | threes[i]);
  const result = Array(8).fill(0);
  const cache = createWinningSquareCache(lines);
  for (const p of bitboardPositions(candidates, Array(8).fill(0), false)) {
    let threeDirs = 0;
    for (const [line, bit] of MEMBERSHIPS[p]) {
      if (
        openThreeAt(lines[color][line], lines[other][line], LINES[line].length, bit)
      )
        threeDirs++;
    }
    updateLineBitboards(lines, p, color, true);
    const undo = cache.refresh(p);
    let winCount = 0;
    for (const word of cache.bitboards[color]) winCount += popcount(word);
    cache.restore(undo);
    updateLineBitboards(lines, p, color, false);
    if (winCount >= 2 || (winCount >= 1 && threeDirs >= 1) || threeDirs >= 2) {
      result[p >>> 5] |= 1 << (p & 31);
    }
  }
  return result;
}

// A position can start a continuous-threat sequence when it holds a four-window
// or any open-three move (mirrors the Rust `vct::can_start`).
export function canStartVct(own, opponent) {
  if (canStartFourSequence(own, opponent)) return true;
  return findThreeCreationSquares(own, opponent).some((word) => word !== 0);
}

export function canStartFourSequence(own, opponent) {
  const popcount = value => {
    let count = 0;
    while (value) { count++; value &= value - 1; }
    return count;
  };
  for (let line = 0; line < LINES.length; line++) {
    const length = LINES[line].length;
    if (length < 5 || popcount(own[line]) < 3) continue;
    for (let start = 0; start <= length - 5; start++) {
      if (popcount((own[line] >>> start) & 31) === 3 &&
          ((opponent[line] >>> start) & 31) === 0) return true;
    }
  }
  return false;
}

export function createWinningSquareCache(lines) {
  function colorState() {
    return {
      bitboard: Array(8).fill(0),
      squares: new Uint16Array(LINES.length),
      references: new Uint8Array(BOARD_CELLS),
      count: 0,
    };
  }
  const black = colorState(),
    white = colorState();
  const bitboards = { black: black.bitboard, white: white.bitboard };

  function replaceLine(line, state, next) {
    let changed = state.squares[line] ^ next;
    if (!changed) return;
    const cells = LINES[line];
    while (changed) {
      const bit = changed & -changed;
      const position = cells[31 - Math.clz32(bit)];
      const slot = position >>> 5,
        boardBit = 1 << (position & 31);
      if (next & bit) {
        if (state.references[position]++ === 0) {
          state.bitboard[slot] |= boardBit;
          state.count++;
        }
      } else if (--state.references[position] === 0) {
        state.bitboard[slot] &= ~boardBit;
        state.count--;
      }
      changed &= changed - 1;
    }
    state.squares[line] = next;
  }
  function refreshLine(line) {
    const length = LINES[line].length;
    if (length < 5) return;
    const own = lines.black[line],
      other = lines.white[line];
    replaceLine(line, black, winningLineSquares(own, other, length));
    replaceLine(line, white, winningLineSquares(other, own, length));
  }
  for (let line = 0; line < LINES.length; line++) refreshLine(line);
  // Record only changed line masks. Quiet moves need no cache undo work;
  // reference counts keep crossing threats intact during restoration.
  function refresh(position) {
    let undo = null;
    for (const [line] of MEMBERSHIPS[position]) {
      const length = LINES[line].length;
      if (length < 5) continue;
      const own = lines.black[line],
        other = lines.white[line];
      const nextBlack = winningLineSquares(own, other, length);
      const nextWhite = winningLineSquares(other, own, length);
      if (nextBlack !== black.squares[line]) {
        (undo ||= []).push([line, black, black.squares[line]]);
        replaceLine(line, black, nextBlack);
      }
      if (nextWhite !== white.squares[line]) {
        (undo ||= []).push([line, white, white.squares[line]]);
        replaceLine(line, white, nextWhite);
      }
    }
    return undo;
  }
  function restore(undo) {
    if (undo)
      for (const [line, state, previous] of undo)
        replaceLine(line, state, previous);
  }
  return {
    bitboards,
    refresh,
    restore,
    hasThreat: (color) => (color === 'black' ? black : white).count !== 0,
  };
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

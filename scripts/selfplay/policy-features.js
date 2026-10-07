import { BOARD_SIZE, BOARD_CELLS } from '../../src/core/constants.js';

// Per-candidate features for a policy move-ordering network. The layout is
// shared with the Rust/JS inference that a later milestone will add; keep the
// count and order in sync with POLICY_FEATURES.
export const POLICY_FEATURES = 25;
const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

const at = (cells, row, col) =>
  row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE
    ? -1
    : cells[row * BOARD_SIZE + col];

/** 0 = empty, 1 = black, 2 = white. */
export function boardCells(blackBitboard, whiteBitboard) {
  const cells = new Uint8Array(BOARD_CELLS);
  for (let slot = 0; slot < 8; slot++) {
    let mask = blackBitboard[slot];
    if (slot === 7) mask &= 1;
    while (mask) {
      cells[slot * 32 + 31 - Math.clz32(mask & -mask)] = 1;
      mask &= mask - 1;
    }
    mask = whiteBitboard[slot];
    if (slot === 7) mask &= 1;
    while (mask) {
      cells[slot * 32 + 31 - Math.clz32(mask & -mask)] = 2;
      mask &= mask - 1;
    }
  }
  return cells;
}

/** Occupied stones within Chebyshev distance two, matching the generator. */
export function neighborhoodDensity(cells) {
  const density = new Uint8Array(BOARD_CELLS);
  for (let p = 0; p < cells.length; p++) {
    if (!cells[p]) continue;
    const row = Math.floor(p / BOARD_SIZE),
      col = p % BOARD_SIZE;
    for (let r = Math.max(0, row - 2); r <= Math.min(BOARD_SIZE - 1, row + 2); r++)
      for (let c = Math.max(0, col - 2); c <= Math.min(BOARD_SIZE - 1, col + 2); c++)
        density[r * BOARD_SIZE + c]++;
  }
  return density;
}

/** Feature vector for one candidate square, independent of any network. */
export function candidateFeatures(cells, position, sideToMove, options) {
  const row = Math.floor(position / BOARD_SIZE),
    col = position % BOARD_SIZE;
  const own = sideToMove === 'black' ? 1 : 2,
    opp = own === 1 ? 2 : 1;
  const features = [
    Math.min(1, options.priority / 1000),
    options.density / 24,
    (14 - Math.abs(row - 7) - Math.abs(col - 7)) / 14,
    (options.tactical ?? 0) / 2,
    options.ply / 224,
  ];
  for (const [dr, dc] of DIRECTIONS) {
    let runPlus = 0,
      k = 1;
    while (k <= 4 && at(cells, row + k * dr, col + k * dc) === own) {
      runPlus++;
      k++;
    }
    const openPlus = k <= 4 && at(cells, row + k * dr, col + k * dc) === 0 ? 1 : 0;
    let runMinus = 0;
    k = 1;
    while (k <= 4 && at(cells, row - k * dr, col - k * dc) === own) {
      runMinus++;
      k++;
    }
    const openMinus = k <= 4 && at(cells, row - k * dr, col - k * dc) === 0 ? 1 : 0;
    let oppPlus = 0;
    k = 1;
    while (k <= 4 && at(cells, row + k * dr, col + k * dc) === opp) {
      oppPlus++;
      k++;
    }
    let oppMinus = 0;
    k = 1;
    while (k <= 4 && at(cells, row - k * dr, col - k * dc) === opp) {
      oppMinus++;
      k++;
    }
    let ownIn4 = 0,
      oppIn4 = 0;
    for (let s = -4; s <= 4; s++) {
      if (s === 0) continue;
      const value = at(cells, row + s * dr, col + s * dc);
      if (value === own) ownIn4++;
      else if (value === opp) oppIn4++;
    }
    features.push(
      Math.min(1, (1 + runPlus + runMinus) / 5),
      (openPlus + openMinus) / 2,
      Math.max(oppPlus, oppMinus) / 4,
      ownIn4 / 8,
      oppIn4 / 8,
    );
  }
  return features;
}

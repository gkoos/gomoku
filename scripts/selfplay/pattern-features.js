import { BOARD_SIZE, BOARD_CELLS } from '../../src/core/constants.js';

// Pattern-category histogram for a learned evaluation, from the side-to-move's
// perspective. Mirrors engine-rust/src/pattern_reference.rs (classify) and
// engine-rust/src/patterns.rs (analyze). Layout: for own then opponent, four
// directions x eight categories (five, open four, four, open three, three,
// open two, two, single), then a normalised stone count.
export const PATTERN_FEATURES = 65;
export const PATTERN_CATEGORIES = 8;
const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

const occupied = (bitboard) => {
  const cells = [];
  for (let slot = 0; slot < 8; slot++) {
    let mask = bitboard[slot];
    if (slot === 7) mask &= 1;
    while (mask) {
      cells.push(slot * 32 + 31 - Math.clz32(mask & -mask));
      mask &= mask - 1;
    }
  }
  return cells;
};
const has = (bitboard, position) => (bitboard[position >>> 5] >>> (position & 31)) & 1;
const popcount = (value) => {
  let count = 0;
  while (value) {
    value &= value - 1;
    count++;
  }
  return count;
};

function openFormation(friendly, blockers, count) {
  for (let start = 0; start <= 3; start++) {
    const ends = (1 << start) | (1 << (start + 5));
    const interior = 0b1111 << (start + 1);
    if (
      ((friendly | blockers) & ends) === 0 &&
      (blockers & interior) === 0 &&
      popcount(friendly & interior) === count
    )
      return true;
  }
  return false;
}

function classify(friendly, blockers) {
  let stones = 0,
    windows = 0,
    winning = 0;
  for (let start = 0; start <= 4; start++) {
    const window = 0b11111 << start;
    if (blockers & window) continue;
    const count = popcount(friendly & window);
    if (count > stones) {
      stones = count;
      windows = 1;
    } else if (count === stones) windows++;
    if (count === 4) winning |= window & ~friendly & 0x1ff;
  }
  return {
    stones,
    winningMoves: popcount(winning),
    openThree: stones === 3 && openFormation(friendly, blockers, 3),
    openTwo: stones === 2 && openFormation(friendly, blockers, 2),
  };
}

export function patternAt(own, opponent, position, direction) {
  const row = Math.floor(position / BOARD_SIZE),
    col = position % BOARD_SIZE;
  const [dr, dc] = DIRECTIONS[direction];
  let friendly = 0,
    blockers = 0;
  for (let offset = -4; offset <= 4; offset++) {
    const r = row + dr * offset,
      c = col + dc * offset;
    const bit = 1 << (offset + 4);
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) {
      blockers |= bit;
      continue;
    }
    const p = r * BOARD_SIZE + c;
    if (has(opponent, p)) blockers |= bit;
    else if (has(own, p)) friendly |= bit;
  }
  return classify(friendly, blockers);
}

/** Category index 0..7, or -1 when the window has no friendly stone. */
export function patternCategory(pattern) {
  if (pattern.stones >= 5) return 0;
  if (pattern.stones === 4) return pattern.winningMoves >= 2 ? 1 : 2;
  if (pattern.stones === 3) return pattern.openThree ? 3 : 4;
  if (pattern.stones === 2) return pattern.openTwo ? 5 : 6;
  if (pattern.stones === 1) return 7;
  return -1;
}

export function patternFeatures(black, white, sideToMove) {
  const own = sideToMove === 'black' ? black : white;
  const opponent = sideToMove === 'black' ? white : black;
  const features = new Array(PATTERN_FEATURES).fill(0);
  const ownCells = occupied(own),
    opponentCells = occupied(opponent);
  for (const position of ownCells)
    for (let direction = 0; direction < 4; direction++) {
      const category = patternCategory(patternAt(own, opponent, position, direction));
      if (category >= 0) features[direction * PATTERN_CATEGORIES + category]++;
    }
  for (const position of opponentCells)
    for (let direction = 0; direction < 4; direction++) {
      const category = patternCategory(patternAt(opponent, own, position, direction));
      if (category >= 0) features[32 + direction * PATTERN_CATEGORIES + category]++;
    }
  features[64] = (ownCells.length + opponentCells.length) / BOARD_CELLS;
  return features;
}

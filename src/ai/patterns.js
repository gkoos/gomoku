import { BOARD_SIZE } from '../core/constants.js';

// Nine-bit masks represent offsets -4 through +4; bit 4 is the anchor.
const BIT_COUNTS = new Uint8Array(1 << 9);
for (let mask = 1; mask < BIT_COUNTS.length; mask++) {
  BIT_COUNTS[mask] = BIT_COUNTS[mask >>> 1] + (mask & 1);
}

export function hasOpenFormation(friendly, blockers, stoneCount) {
  const occupied = friendly | blockers;
  for (let start = 0; start <= 3; start++) {
    const ends = (1 << start) | (1 << (start + 5));
    const interior = 0b1111 << (start + 1);
    if ((occupied & ends) !== 0 || (blockers & interior) !== 0) continue;
    if (BIT_COUNTS[friendly & interior] === stoneCount) return true;
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
  let friendly = 0,
    blockers = 0;
  for (let offset = -4; offset <= 4; offset++) {
    const r = row + dRow * offset;
    const c = col + dCol * offset;
    const lineBit = 1 << (offset + 4);
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) {
      blockers |= lineBit;
      continue;
    }
    const position = r * BOARD_SIZE + c;
    const slot = position >>> 5;
    const boardBit = 1 << (position & 31);
    if ((opponentBitboard[slot] & boardBit) !== 0) blockers |= lineBit;
    else if ((playerBitboard[slot] & boardBit) !== 0) friendly |= lineBit;
  }

  let stones = 0,
    windows = 0,
    winningSquares = 0;
  for (let start = 0; start <= 4; start++) {
    const window = 0b11111 << start;
    if ((blockers & window) !== 0) continue;
    const count = BIT_COUNTS[friendly & window];
    if (count > stones) {
      stones = count;
      windows = 1;
    } else if (count === stones) {
      windows++;
    }
    if (count === 4) winningSquares |= window & ~friendly;
  }
  return {
    stones,
    windows,
    winningMoves: BIT_COUNTS[winningSquares],
    openThree: stones === 3 && hasOpenFormation(friendly, blockers, 3),
    openTwo: stones === 2 && hasOpenFormation(friendly, blockers, 2),
  };
}

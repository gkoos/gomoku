import { BOARD_CELLS, oppositeColor } from '../core/constants.js';

let seed = 0x9e3779b9;
function nextWord() {
  seed = (seed + 0x9e3779b9) >>> 0;
  let value = Math.imul(seed ^ (seed >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return (value ^ (value >>> 15)) >>> 0;
}
const STONES = Array.from({ length: BOARD_CELLS * 2 }, () => [
  nextWord(),
  nextWord(),
]);
const SIDE = [nextWord(), nextWord()];

/** Two 32-bit words form a deterministic 64-bit Zobrist key. */
export function createPositionHasher(blackBitboard, whiteBitboard, toMove) {
  oppositeColor(toMove);
  let low = 0,
    high = 0;
  for (let position = 0; position < BOARD_CELLS; position++) {
    const mask = 1 << (position % 32),
      slot = position >>> 5;
    for (const [color, board] of [
      [0, blackBitboard],
      [1, whiteBitboard],
    ]) {
      if ((board[slot] & mask) !== 0) {
        low ^= STONES[position * 2 + color][0];
        high ^= STONES[position * 2 + color][1];
      }
    }
  }
  if (toMove === 'white') {
    low ^= SIDE[0];
    high ^= SIDE[1];
  }

  function toggleMove(position, color) {
    if (!Number.isInteger(position) || position < 0 || position >= BOARD_CELLS)
      throw new RangeError('Move is outside the board');
    oppositeColor(color);
    const words = STONES[position * 2 + (color === 'black' ? 0 : 1)];
    low ^= words[0];
    high ^= words[1];
    low ^= SIDE[0];
    high ^= SIDE[1];
    toMove = oppositeColor(toMove);
  }
  return {
    toggleMove,
    get key() {
      return (high >>> 0) + ':' + (low >>> 0);
    },
    get toMove() {
      return toMove;
    },
  };
}

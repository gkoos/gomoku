export const BOARD_SIZE = 15;
export const BOARD_CELLS = 225;
export const BITBOARD_SLOTS = 8;

/** A position contains blackBitboard, whiteBitboard, and toMove. */
export function oppositeColor(color) {
  if (color !== 'black' && color !== 'white')
    throw new TypeError('Invalid player color');
  return color === 'black' ? 'white' : 'black';
}

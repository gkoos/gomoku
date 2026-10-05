// Bitboard utilities for Gomoku
// Converts 15x15 board to bitboard representation using arrays of 8 numbers

import { BOARD_SIZE } from './constants.js';
const BITS_PER_NUMBER = 32;

/**
 * Converts a 15x15 board to black and white bitboards
 * @param {Array<Array<string|null>>} board - The game board (15x15 array)
 * @returns {Object} - Object containing blackBitboard and whiteBitboard, each as array of 8 numbers
 */
function board2Bitboards(board) {
  // Initialize bitboards as arrays of 8 numbers to handle all 225 positions
  const blackBitboard = [0, 0, 0, 0, 0, 0, 0, 0];
  const whiteBitboard = [0, 0, 0, 0, 0, 0, 0, 0];

  // Iterate through each position on the board
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      // Calculate linear position (0-224)
      const position = row * BOARD_SIZE + col;

      // Determine which number in the array and which bit within that number
      const arrayIndex = Math.floor(position / BITS_PER_NUMBER);
      const bitIndex = position % BITS_PER_NUMBER;

      // The eight slots cover all 225 board cells.
      if (arrayIndex < 8) {
        const cell = board[row][col];

        if (cell === 'black') {
          // Set the bit for black player
          blackBitboard[arrayIndex] |= 1 << bitIndex;
        } else if (cell === 'white') {
          // Set the bit for white player
          whiteBitboard[arrayIndex] |= 1 << bitIndex;
        }
        // null cells remain as 0 bits (already initialized)
      }
    }
  }

  return {
    blackBitboard,
    whiteBitboard,
  };
}

export { board2Bitboards };

// Only the low bit of the final word belongs to the 225-square board.
export function validWordMask(word) {
  return word === 7 ? 1 : -1;
}

/** Enumerate occupied squares (or empty squares) in row-major order. */
export function* bitboardPositions(first, second = null, empty = false) {
  for (let word = 0; word < 8; word++) {
    const occupied = first[word] | (second?.[word] ?? 0);
    let mask = (empty ? ~occupied : occupied) & validWordMask(word);
    while (mask) {
      yield word * 32 + 31 - Math.clz32(mask & -mask);
      mask &= mask - 1;
    }
  }
}

export function bitboardsOverlap(black, white) {
  for (let word = 0; word < 8; word++) {
    if (black[word] & white[word] & validWordMask(word)) return true;
  }
  return false;
}

export function bitboardsFull(black, white) {
  for (let word = 0; word < 8; word++) {
    const valid = validWordMask(word);
    if (((black[word] | white[word]) & valid) !== valid) return false;
  }
  return true;
}

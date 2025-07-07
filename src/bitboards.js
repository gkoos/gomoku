// Bitboard utilities for Gomoku
// Converts 15x15 board to bitboard representation using arrays of 4 numbers

const BOARD_SIZE = 15;
const TOTAL_POSITIONS = BOARD_SIZE * BOARD_SIZE; // 225 positions
const BITS_PER_NUMBER = 32;
const NUMBERS_NEEDED = Math.ceil(TOTAL_POSITIONS / BITS_PER_NUMBER); // 8, but we'll use 4 arrays for efficiency

/**
 * Converts a 15x15 board to black and white bitboards
 * @param {Array<Array<string|null>>} board - The game board (15x15 array)
 * @returns {Object} - Object containing blackBitboard and whiteBitboard, each as array of 4 numbers
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
      
      // Only process if we have a valid array index - NEED MORE SLOTS!
      if (arrayIndex < 8) { // Changed from 4 to 8 to handle all 225 positions
        const cell = board[row][col];
        
        if (cell === 'black') {
          // Set the bit for black player
          blackBitboard[arrayIndex] |= (1 << bitIndex);
        } else if (cell === 'white') {
          // Set the bit for white player
          whiteBitboard[arrayIndex] |= (1 << bitIndex);
        }
        // null cells remain as 0 bits (already initialized)
      }
    }
  }
  
  return {
    blackBitboard,
    whiteBitboard
  };
}

// Make functions available globally for worker context
if (typeof self !== 'undefined') {
  self.board2Bitboards = board2Bitboards;
}

export { board2Bitboards };

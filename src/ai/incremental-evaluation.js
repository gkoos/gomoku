import { BOARD_SIZE, BOARD_CELLS, oppositeColor } from '../core/constants.js';
import { MAX_STATIC_SCORE } from './config.js';
import { scoreLinePattern } from './evaluation.js';
import { analyzePackedLinePattern } from './patterns.js';
import {
  createLineBitboards,
  updateLineBitboards,
  createWinningSquareCache,
  threatMovesFromBitboard,
} from './line-bitboards.js';

const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

// An anchored pattern reads only offsets -4 through +4. A move can therefore
// change these direction-specific contributions, including the opponent's.
const AFFECTED_CONTRIBUTIONS = Array.from(
  { length: BOARD_CELLS },
  (_, position) => {
    const row = Math.floor(position / BOARD_SIZE),
      col = position % BOARD_SIZE;
    const indices = [];
    for (let direction = 0; direction < DIRECTIONS.length; direction++) {
      const [dr, dc] = DIRECTIONS[direction];
      for (let offset = -4; offset <= 4; offset++) {
        const r = row + dr * offset,
          c = col + dc * offset;
        if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
          indices.push((r * BOARD_SIZE + c) * 4 + direction);
        }
      }
    }
    return new Uint16Array(indices);
  },
);

/** Owns a private board and signed per-stone/per-direction scores.
 * Moves must be undone in reverse order. Caller bitboards remain unchanged.
 */
export function createIncrementalEvaluator(
  blackBitboard,
  whiteBitboard,
  perspective,
) {
  oppositeColor(perspective);
  const black = [...blackBitboard],
    white = [...whiteBitboard];
  const lineBitboards = createLineBitboards(black, white);
  const winningSquares = createWinningSquareCache(lineBitboards);
  const scores = new Int32Array(BOARD_CELLS * 4),
    history = [];
  let total = 0;

  function contribution(index) {
    const position = index >>> 2,
      direction = index & 3;
    const mask = 1 << (position % 32),
      slot = position >>> 5;
    const isBlack = (black[slot] & mask) !== 0;
    if (!isBlack && (white[slot] & mask) === 0) return 0;
    const value = scoreLinePattern(
      analyzePackedLinePattern(
        isBlack ? lineBitboards.black : lineBitboards.white,
        isBlack ? lineBitboards.white : lineBitboards.black,
        position,
        direction,
      ),
    );
    return isBlack ? value : -value;
  }

  for (let index = 0; index < scores.length; index++) {
    scores[index] = contribution(index);
    total += scores[index];
  }

  function makeMove(position, color) {
    if (!Number.isInteger(position) || position < 0 || position >= BOARD_CELLS)
      throw new RangeError('Move is outside the board');
    oppositeColor(color);
    const slot = position >>> 5,
      mask = 1 << (position % 32);
    if (((black[slot] | white[slot]) & mask) !== 0)
      throw new Error('Move occupies an existing stone');
    const indices = AFFECTED_CONTRIBUTIONS[position];
    const previousScores = new Int32Array(indices.length);
    const frame = {
      token: {},
      position,
      color,
      total,
      previousScores,
    };
    const stones = color === 'black' ? black : white;
    stones[slot] |= mask;
    updateLineBitboards(lineBitboards, position, color, true);
    frame.winningSquaresUndo = winningSquares.refresh(position);
    for (let offset = 0; offset < indices.length; offset++) {
      const index = indices[offset];
      previousScores[offset] = scores[index];
      const next = contribution(index);
      total += next - scores[index];
      scores[index] = next;
    }
    history.push(frame);
    return frame.token;
  }

  function undoMove(token) {
    const frame = history.at(-1);
    if (!frame || token !== frame.token)
      throw new Error('Moves must be undone in reverse order');
    const stones = frame.color === 'black' ? black : white;
    stones[frame.position >>> 5] &= ~(1 << (frame.position % 32));
    updateLineBitboards(lineBitboards, frame.position, frame.color, false);
    winningSquares.restore(frame.winningSquaresUndo);
    const indices = AFFECTED_CONTRIBUTIONS[frame.position];
    for (let offset = 0; offset < indices.length; offset++) {
      scores[indices[offset]] = frame.previousScores[offset];
    }
    // Preserve the raw total: clamping between moves would lose information.
    total = frame.total;
    history.pop();
  }

  function getScore() {
    if (total === 0) return 0;
    const score = perspective === 'black' ? total : -total;
    return Math.max(-MAX_STATIC_SCORE, Math.min(MAX_STATIC_SCORE, score));
  }

  function hasImmediateThreat(color) {
    oppositeColor(color);
    return winningSquares.hasThreat(color);
  }
  function getWinningMoves(color) {
    oppositeColor(color);
    return threatMovesFromBitboard(winningSquares.bitboards[color], 'win');
  }
  return {
    makeMove,
    undoMove,
    getScore,
    hasImmediateThreat,
    lineBitboards,
    winningSquareBitboards: winningSquares.bitboards,
    getWinningMoves,
  };
}

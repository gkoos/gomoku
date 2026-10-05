import { BOARD_CELLS } from '../core/constants.js';
import { WIN_SCORE, TRANSPOSITION_TABLE_SIZE } from './config.js';

export const EXACT = 'EXACT';
export const LOWER_BOUND = 'LOWER';
export const UPPER_BOUND = 'UPPER';

export function scoreToTable(score, ply) {
  if (score >= WIN_SCORE - BOARD_CELLS) return score + ply;
  if (score <= -WIN_SCORE + BOARD_CELLS) return score - ply;
  return score;
}
export function scoreFromTable(score, ply) {
  if (score >= WIN_SCORE - BOARD_CELLS) return score - ply;
  if (score <= -WIN_SCORE + BOARD_CELLS) return score + ply;
  return score;
}

/** FIFO capacity bound. Hash hits must also match the complete position. */
export function createTranspositionTable({
  maxEntries = TRANSPOSITION_TABLE_SIZE,
} = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1)
    throw new RangeError('Table capacity must be a positive integer');
  const entries = new Map();
  function matches(entry, black, white, toMove) {
    return (
      entry.toMove === toMove &&
      entry.black.every((value, index) => value === black[index] >>> 0) &&
      entry.white.every((value, index) => value === white[index] >>> 0)
    );
  }
  function get(key, black, white, toMove) {
    const entry = entries.get(key);
    return entry && matches(entry, black, white, toMove) ? entry : null;
  }
  function store(key, black, white, toMove, result) {
    const previous = get(key, black, white, toMove);
    // Keep exact values and the stronger bound when an entry is revisited.
    if (
      previous &&
      ((previous.flag === EXACT && result.flag !== EXACT) ||
        (previous.flag === result.flag &&
          result.flag === LOWER_BOUND &&
          previous.score >= result.score) ||
        (previous.flag === result.flag &&
          result.flag === UPPER_BOUND &&
          previous.score <= result.score))
    )
      return;
    if (!entries.has(key) && entries.size >= maxEntries)
      entries.delete(entries.keys().next().value);
    entries.set(key, {
      ...result,
      toMove,
      black: Array.from(black, (value) => value >>> 0),
      white: Array.from(white, (value) => value >>> 0),
      move: result.move ? { ...result.move } : null,
      principalVariation: result.principalVariation?.map((move) => ({
        ...move,
      })),
    });
  }
  return {
    get,
    store,
    clear: () => entries.clear(),
    get size() {
      return entries.size;
    },
  };
}

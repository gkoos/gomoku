import { bitboardPositions } from '../core/bitboards.js';
import { getBitboardResult } from '../core/rules.js';
import {
  createLineBitboards,
  createWinningSquareCache,
  updateLineBitboards,
  findFourCreationSquares,
  findThreeCreationSquares,
  isCleanThree,
} from './line-bitboards.js';

export const VCT_MAX_PLIES = 15;
export const VCT_NODE_BUDGET = 2048;
export const VCT_HORIZON_PLIES = 7;
export const VCT_HORIZON_NODES = 32;
const empty = Array(8).fill(0);

function popcount(board) {
  let total = 0;
  for (let word = 0; word < 8; word++) total += popcountWord(board[word]);
  return total;
}

function popcountWord(value) {
  let count = 0;
  while (value) {
    count++;
    value &= value - 1;
  }
  return count;
}

function contains(board, position) {
  return (board[position >>> 5] & (1 << (position & 31))) !== 0;
}

/**
 * Proof-only continuous-threat search over fours and double threes. Unknown
 * never means a forced loss. Returns `{ proven, nodes, exhausted, line, plies }`
 * where `plies` is the exact win distance (the returned `line` may be truncated
 * to the winning move for double threes).
 */
export function solveVct(
  black,
  white,
  attacker,
  maxPlies = VCT_MAX_PLIES,
  budget = VCT_NODE_BUDGET,
) {
  if (
    !Number.isInteger(maxPlies) ||
    maxPlies < 0 ||
    maxPlies > 31 ||
    !Number.isInteger(budget) ||
    budget < 0 ||
    budget > 1000000
  ) {
    throw new RangeError('VCT limits: at most 31 plies and 1000000 nodes');
  }
  if (!['black', 'white'].includes(attacker)) throw new RangeError('Invalid VCT attacker');
  if (getBitboardResult(black, white)) {
    return { proven: false, nodes: 0, exhausted: false, line: [], plies: 0 };
  }
  const defender = attacker === 'black' ? 'white' : 'black';
  const lines = createLineBitboards(black, white);
  const cache = createWinningSquareCache(lines);
  const squares = (color) => [...bitboardPositions(cache.bitboards[color], empty, false)];
  const count = (color) => popcount(cache.bitboards[color]);
  let nodes = 0;
  let exhausted = false;
  const tick = () => {
    if (nodes >= budget) {
      exhausted = true;
      return false;
    }
    nodes++;
    return true;
  };

  function consider(p, remaining) {
    if (!tick()) return null;
    updateLineBitboards(lines, p, attacker, true);
    const undo = cache.refresh(p);
    let result = null;
    try {
      const winCount = count(attacker);
      let threeDirs = 0;
      for (let direction = 0; direction < 4; direction++) {
        if (isCleanThree(lines, attacker, p, direction)) threeDirs++;
      }
      if (winCount >= 2 && remaining >= 3) {
        const winning = squares(attacker);
        result = { line: [p, winning[0], winning[1]], plies: 3 };
      } else if (winCount === 0 && threeDirs >= 2 && remaining >= 5) {
        // A double three wins only if the defender has no four-threat to force
        // a reply first; otherwise their counter disrupts the chain.
        const defenderFours = findFourCreationSquares(lines[defender], lines[attacker]);
        if (defenderFours.every((word) => word === 0)) {
          result = { line: [p], plies: 5 };
        }
      } else if (count(defender) === 0 && winCount === 1 && remaining >= 3) {
        const block = squares(attacker)[0];
        updateLineBitboards(lines, block, defender, true);
        const replyUndo = cache.refresh(block);
        try {
          const tail = attack(remaining - 2);
          if (tail) result = { line: [p, block, ...tail.line], plies: tail.plies + 2 };
        } finally {
          updateLineBitboards(lines, block, defender, false);
          cache.restore(replyUndo);
        }
      }
    } finally {
      updateLineBitboards(lines, p, attacker, false);
      cache.restore(undo);
    }
    return result;
  }

  function attack(remaining) {
    if (remaining === 0 || !tick()) return null;
    if (count(attacker)) return { line: [squares(attacker)[0]], plies: 1 };
    const enemyCount = count(defender);
    if (enemyCount >= 2) return null;
    const mandatory = enemyCount === 1 ? squares(defender)[0] : null;
    const fours = findFourCreationSquares(lines[attacker], lines[defender]);
    const threes = findThreeCreationSquares(lines[attacker], lines[defender]);
    // Prefer the fastest wins: scan for a double four (three plies) first, so a
    // quick fork is never outranked by a slower four-three or double-three chain.
    for (const p of bitboardPositions(fours, empty, false)) {
      if (mandatory !== null && mandatory !== p) continue;
      if (!tick()) return null;
      updateLineBitboards(lines, p, attacker, true);
      const undo = cache.refresh(p);
      const winCount = count(attacker);
      let fast = null;
      if (winCount >= 2 && remaining >= 3) {
        const winning = squares(attacker);
        fast = { line: [p, winning[0], winning[1]], plies: 3 };
      }
      updateLineBitboards(lines, p, attacker, false);
      cache.restore(undo);
      if (fast) return fast;
    }
    for (const p of bitboardPositions(fours, empty, false)) {
      if (mandatory !== null && mandatory !== p) continue;
      const result = consider(p, remaining);
      if (result) return result;
      if (exhausted) return null;
    }
    if (remaining >= 5) {
      for (const p of bitboardPositions(threes, empty, false)) {
        if (contains(fours, p) || (mandatory !== null && mandatory !== p)) continue;
        const result = consider(p, remaining);
        if (result) return result;
        if (exhausted) return null;
      }
    }
    return null;
  }

  const result = attack(maxPlies);
  return {
    proven: !!result,
    nodes,
    exhausted,
    line: result ? result.line : [],
    plies: result ? result.plies : 0,
  };
}

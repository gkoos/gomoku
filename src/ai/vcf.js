import { bitboardPositions } from '../core/bitboards.js';
import { getBitboardResult } from '../core/rules.js';
import { createLineBitboards, createWinningSquareCache, updateLineBitboards, findFourCreationSquares } from './line-bitboards.js';

export const VCF_MAX_PLIES = 15;
export const VCF_NODE_BUDGET = 2048;
const empty = Array(8).fill(0);

/** Only proven continuous-four wins affect selection; unknown is not a loss. */
export function solveVcf(black, white, attacker, maxPlies = VCF_MAX_PLIES, budget = VCF_NODE_BUDGET) {
  if (!Number.isInteger(maxPlies) || maxPlies < 0 || maxPlies > 31 || !Number.isInteger(budget) || budget < 0 || budget > 1000000) {
    throw new RangeError('VCF limits: at most 31 plies and 1000000 nodes');
  }
  if (!['black', 'white'].includes(attacker)) throw new RangeError('Invalid VCF attacker');
  if (getBitboardResult(black, white)) return { proven: false, nodes: 0, exhausted: false, line: [] };
  const defender = attacker === 'black' ? 'white' : 'black';
  const lines = createLineBitboards(black, white), cache = createWinningSquareCache(lines);
  const squares = color => [...bitboardPositions(cache.bitboards[color], empty, false)];
  let nodes = 0, exhausted = false;
  const tick = () => { if (nodes >= budget) { exhausted = true; return false; } nodes++; return true; };
  function attack(remaining) {
    if (!remaining || !tick()) return null;
    const own = squares(attacker), enemy = squares(defender);
    if (own.length) return [own[0]];
    if (enemy.length >= 2 || remaining < 3) return null;
    const candidates = findFourCreationSquares(lines[attacker], lines[defender]);
    for (const p of bitboardPositions(candidates, empty, false)) {
      if (enemy.length === 1 && enemy[0] !== p) continue;
      if (!tick()) break;
      updateLineBitboards(lines, p, attacker, true);
      const undo = cache.refresh(p);
      let result = null;
      try {
        const threats = squares(attacker);
        if (!cache.hasThreat(defender) && threats.length >= 2) result = [p, threats[0], threats[1]];
        else if (!cache.hasThreat(defender) && threats.length === 1) {
          const block = threats[0];
          updateLineBitboards(lines, block, defender, true);
          const replyUndo = cache.refresh(block);
          try { const tail = attack(remaining - 2); if (tail) result = [p, block, ...tail]; }
          finally { updateLineBitboards(lines, block, defender, false); cache.restore(replyUndo); }
        }
      } finally { updateLineBitboards(lines, p, attacker, false); cache.restore(undo); }
      if (result) return result;
      if (exhausted) break;
    }
    return null;
  }
  const line = attack(maxPlies) || [];
  return { proven: line.length > 0, nodes, exhausted, line };
}

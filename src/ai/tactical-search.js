import { WIN_SCORE } from './config.js';
import { checkImmediateThreat } from './threats.js';
import { solveVcf, VCF_HORIZON_PLIES, VCF_HORIZON_NODES } from './vcf.js';
import { canStartFourSequence } from './line-bitboards.js';

function quietResult(black, white, maximizing, own, ply, tracker, state, context, remaining) {
  const other = own === 'black' ? 'white' : 'black';
  if (remaining > 0 && (!state.lineBitboards ||
      canStartFourSequence(state.lineBitboards[own], state.lineBitboards[other]))) {
    const key = `${own}/${black.map(word => word >>> 0).join(',')}/${white.map(word => word >>> 0).join(',')}`;
    const cache = context?.vcfCache;
    let proof = cache?.get(key);
    if (!proof) {
      proof = solveVcf(black, white, own, VCF_HORIZON_PLIES, VCF_HORIZON_NODES);
      if (cache?.size >= 2048) cache.clear();
      cache?.set(key, proof);
    }
    if (proof.proven) {
      const line = proof.line.map(position => ({
        position, row: Math.floor(position / 15), col: position % 15,
      }));
      const distance = ply + line.length;
      return {
        score: maximizing ? WIN_SCORE - distance : -WIN_SCORE + distance,
        move: line[0],
        ...(tracker?.trackPV ? { principalVariation: line } : {}),
      };
    }
  }
  return { score: state.getScore(), move: null };
}

// Extend forced replies, then probe bounded VCF for the actual side to move.
// An opponent's hypothetical win on a different turn is not a loss proof.
export function evaluateTacticalHorizon(
  black,
  white,
  maximizing,
  computer,
  human,
  ply,
  tracker,
  state,
  context,
  remaining,
) {
  const own = maximizing ? computer : human;
  const other = maximizing ? human : computer;
  const ownThreat = state.hasImmediateThreat?.(own) ?? true;
  const otherThreat = state.hasImmediateThreat?.(other) ?? true;
  if (!ownThreat && !otherThreat)
    return quietResult(black, white, maximizing, own, ply, tracker, state, context, remaining);

  const wins = ownThreat
    ? (state.getWinningMoves?.(own) ??
      checkImmediateThreat(black, white, own, state.lineBitboards))
    : [];
  if (wins.length) {
    const move = wins[0];
    return {
      score: maximizing ? WIN_SCORE - ply - 1 : -WIN_SCORE + ply + 1,
      move,
      ...(tracker?.trackPV ? { principalVariation: [move] } : {}),
    };
  }
  const threats = otherThreat
    ? (state.getWinningMoves?.(other) ??
      checkImmediateThreat(black, white, other, state.lineBitboards))
    : [];
  if (threats.length >= 2) {
    // No single stone can cover two winning squares, and we cannot win first.
    const block = threats[0];
    return {
      score: maximizing ? -WIN_SCORE + ply + 2 : WIN_SCORE - ply - 2,
      move: block,
      ...(tracker?.trackPV ? { principalVariation: [block, threats[1]] } : {}),
    };
  }
  if (!threats.length || remaining === 0)
    return quietResult(black, white, maximizing, own, ply, tracker, state, context, remaining);

  const move = threats[0];
  const nextBlack = [...black],
    nextWhite = [...white];
  (own === 'black' ? nextBlack : nextWhite)[move.position >>> 5] |=
    1 << (move.position & 31);
  const undo = state.makeMove(move.position, own);
  context?.hasher.toggleMove(move.position, own);
  let result;
  try {
    if (tracker?.nodes !== undefined) tracker.nodes++;
    result = evaluateTacticalHorizon(
      nextBlack,
      nextWhite,
      !maximizing,
      computer,
      human,
      ply + 1,
      tracker,
      state,
      context,
      remaining - 1,
    );
  } finally {
    context?.hasher.toggleMove(move.position, own);
    state.undoMove(undo);
  }
  return {
    score: result.score,
    move,
    ...(tracker?.trackPV
      ? { principalVariation: [move, ...(result.principalVariation || [])] }
      : {}),
  };
}

import { WIN_SCORE } from './config.js';
import { checkImmediateThreat } from './threats.js';

// Extend only forced replies. Quiet positions retain constant-time evaluation;
// leaves are not cached, and both evaluation and hash state restore on undo.
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
    return { score: state.getScore(), move: null };

  const wins = ownThreat ? checkImmediateThreat(black, white, own) : [];
  if (wins.length) {
    const move = wins[0];
    return {
      score: maximizing ? WIN_SCORE - ply - 1 : -WIN_SCORE + ply + 1,
      move,
      ...(tracker?.trackPV ? { principalVariation: [move] } : {}),
    };
  }
  const threats = otherThreat ? checkImmediateThreat(black, white, other) : [];
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
    return { score: state.getScore(), move: null };

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

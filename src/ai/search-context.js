import { TACTICAL_EXTENSION_PLIES } from './config.js';
import { createPositionHasher } from './zobrist.js';
import { createTranspositionTable } from './transposition-table.js';

export function createSearchContext(
  black,
  white,
  toMove,
  { table = createTranspositionTable() } = {},
) {
  return {
    table,
    hasher: createPositionHasher(black, white, toMove),
    stats: { hits: 0, cutoffs: 0, stores: 0 },
  };
}

/** Exact depth and remaining PV are part of the selective-search contract.
 * A deeper result is not interchangeable with a shallower heuristic horizon.
 */
export function transpositionKey(
  context,
  depth,
  perspective,
  history,
  tracker,
  tacticalExtension = TACTICAL_EXTENSION_PLIES,
) {
  const pv = tracker?.principalVariation || [];
  const followsPV = history.every(
    (move, index) => move.position === pv[index]?.position,
  );
  const suffix =
    followsPV && history.length < pv.length
      ? pv
          .slice(history.length)
          .map((move) => move.position)
          .join(',')
      : '';
  return (
    context.hasher.key +
    '/' +
    depth +
    '/q' +
    tacticalExtension +
    '/' +
    perspective +
    '/' +
    (tracker?.trackPV ? 'pv/' : 'score/') +
    suffix
  );
}

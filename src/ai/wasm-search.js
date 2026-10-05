import { findBestMove } from './engine.js';
import { findBestMoveDeepSearch } from './search.js';
import {
  TACTICAL_EXTENSION_PLIES,
  TRANSPOSITION_TABLE_SIZE,
} from './config.js';

/** Keep Wasm state inside the worker; exchange only completed iteration results. */
export function createWasmDeepSearch(SearchEngine) {
  return function deepSearch(
    black,
    white,
    computer,
    human,
    onProgress,
    depth,
    options = {},
  ) {
    // An injected JavaScript table cannot be transferred into a Rust search.
    if (options.transpositionTable)
      return findBestMoveDeepSearch(
        black,
        white,
        computer,
        human,
        onProgress,
        depth,
        options,
      );
    const search = new SearchEngine(
      Uint32Array.from(black),
      Uint32Array.from(white),
      computer === 'black',
      depth,
      options.tacticalExtension ?? TACTICAL_EXTENSION_PLIES,
      options.useTranspositionTable === false ? 0 : TRANSPOSITION_TABLE_SIZE,
    );
    return runIterations(search, onProgress, depth, options);
  };
}

/** Lazy initialization is shared by requests; a load failure retains JS search. */
export function createWasmChooseMove({
  loadEngine,
  reportError = console.warn,
}) {
  let loading;
  return async function chooseMove(
    black,
    white,
    computer,
    human,
    difficulty,
    onProgress,
    options = {},
  ) {
    if (options.transpositionTable)
      return findBestMove(
        black,
        white,
        computer,
        human,
        difficulty,
        onProgress,
        options,
      );
    loading ??= Promise.resolve()
      .then(loadEngine)
      .catch((error) => {
        reportError(
          'Wasm initialization failed; using JavaScript search:',
          error,
        );
        return null;
      });
    const engine = await loading;
    if (!engine)
      return findBestMove(
        black,
        white,
        computer,
        human,
        difficulty,
        onProgress,
        options,
      );
    const level = { easy: 0, medium: 1, hard: 2, expert: 3 }[difficulty] ?? 0;
    const search = new engine.MoveEngine(
      Uint32Array.from(black),
      Uint32Array.from(white),
      computer === 'black',
      level,
      options.tacticalExtension ?? TACTICAL_EXTENSION_PLIES,
      options.useTranspositionTable === false ? 0 : TRANSPOSITION_TABLE_SIZE,
    );
    const root = search.root_move();
    if (root !== -2) {
      try {
        onProgress?.(100);
        return root < 0 ? null : { row: Math.floor(root / 15), col: root % 15 };
      } finally {
        search.free();
      }
    }
    return runIterations(search, onProgress, [0, 6, 8, 10][level], options);
  };
}

function runIterations(search, onProgress, depth, options) {
  let bestMove = null;
  try {
    for (;;) {
      const result = search.next_depth();
      if (!result.length) break;
      const [
        completedDepth,
        score,
        nodes,
        cacheHits,
        cacheCutoffs,
        tableSize,
        pvLength,
      ] = result;
      const principalVariation = Array.from(
        result.slice(7, 7 + pvLength),
        (position) => ({
          row: Math.floor(position / 15),
          col: position % 15,
          position,
        }),
      );
      bestMove = principalVariation[0];
      options.onIteration?.({
        depth: completedDepth,
        move: bestMove,
        score,
        nodes,
        cacheHits,
        cacheCutoffs,
        tableSize,
        principalVariation,
      });
      onProgress?.(Math.floor((completedDepth / depth) * 100));
    }
    onProgress?.(100);
    return bestMove;
  } finally {
    search.free();
  }
}

import { createSearchContext, transpositionKey } from './search-context.js';
import {
  EXACT,
  LOWER_BOUND,
  UPPER_BOUND,
  scoreToTable,
  scoreFromTable,
} from './transposition-table.js';
import { BOARD_SIZE } from '../core/constants.js';
import { WIN_SCORE, TACTICAL_EXTENSION_PLIES } from './config.js';
import { evaluateTacticalHorizon } from './tactical-search.js';
import { checkWinCondition, getBitboardResult } from '../core/rules.js';
import { generateCandidateMoves } from './moves.js';
import { createIncrementalEvaluator } from './incremental-evaluation.js';
import {
  createLineBitboards,
  findOpenFourSquares,
  findWinningSquares,
  updateLineBitboards,
  threatMovesFromBitboard,
} from './line-bitboards.js';

export function minimaxAlphaBeta(
  blackBitboard,
  whiteBitboard,
  depth,
  alpha,
  beta,
  isMaximizing,
  computerPlayer,
  humanPlayer,
  moveHistory = [],
  progressTracker = null,
  evaluationState = null,
  searchContext = null,
  tacticalExtension = TACTICAL_EXTENSION_PLIES,
) {
  if (progressTracker?.nodes !== undefined) progressTracker.nodes++;

  // Check for immediate wins/losses
  const computerBitboard =
    computerPlayer === 'black' ? blackBitboard : whiteBitboard;
  const opponentBitboard =
    computerPlayer === 'black' ? whiteBitboard : blackBitboard;

  if (moveHistory.length === 0) {
    const result = getBitboardResult(blackBitboard, whiteBitboard);
    if (result) {
      const score = result.winner
        ? result.winner === computerPlayer
          ? WIN_SCORE
          : -WIN_SCORE
        : 0;
      return { score, move: null };
    }
  }

  // Check if game is already won
  if (moveHistory.length > 0) {
    const lastMove = moveHistory[moveHistory.length - 1];
    const lastPlayer = isMaximizing ? humanPlayer : computerPlayer;
    const lastBitboard =
      lastPlayer === computerPlayer ? computerBitboard : opponentBitboard;

    if (
      checkWinCondition(lastBitboard, lastMove.row * BOARD_SIZE + lastMove.col)
    ) {
      if (lastPlayer === computerPlayer) {
        return { score: WIN_SCORE - moveHistory.length, move: null }; // Prefer faster wins
      } else {
        return { score: -WIN_SCORE + moveHistory.length, move: null }; // Delay losses
      }
    }
  }

  // Check the opponent's immediate fork while comparing root defenses.
  if (moveHistory.length === 1 && (depth > 0 || tacticalExtension >= 3)) {
    const state = evaluationState ||
      createIncrementalEvaluator(blackBitboard, whiteBitboard, computerPlayer);
    const lines = state.lineBitboards || createLineBitboards(blackBitboard, whiteBitboard);
    const hasWin = color => state.hasImmediateThreat?.(color) ??
      findWinningSquares(lines[color], lines[color === computerPlayer ? humanPlayer : computerPlayer])
        .some(mask => mask !== 0);
    if (
      !hasWin(computerPlayer) && !hasWin(humanPlayer)
    ) {
      const color = isMaximizing ? computerPlayer : humanPlayer;
      const other = isMaximizing ? humanPlayer : computerPlayer;
      const fork = threatMovesFromBitboard(
        findOpenFourSquares(lines[color], lines[other]), 0,
      )[0];
      if (fork) {
        updateLineBitboards(lines, fork.position, color, true);
        let ends;
        try {
          ends = threatMovesFromBitboard(
            findWinningSquares(lines[color], lines[other]), 0,
          );
        } finally {
          updateLineBitboards(lines, fork.position, color, false);
        }
        return {
          score: isMaximizing ? WIN_SCORE - 4 : -WIN_SCORE + 4,
          move: fork,
          ...(progressTracker?.trackPV
            ? { principalVariation: [fork, ends[0], ends[1]] } : {}),
        };
      }
    }
  }

  // Extend forced replies and eligible VCF attacks separately. Static scoring
  // remains O(1); horizon proofs use their own cache, not normal TT entries.
  if (depth === 0) {
    const state =
      evaluationState ||
      createIncrementalEvaluator(blackBitboard, whiteBitboard, computerPlayer);
    return tacticalExtension === 0
      ? { score: state.getScore(), move: null }
      : evaluateTacticalHorizon(
          blackBitboard,
          whiteBitboard,
          isMaximizing,
          computerPlayer,
          humanPlayer,
          moveHistory.length,
          progressTracker,
          state,
          searchContext,
          tacticalExtension,
        );
  }

  const toMove = isMaximizing ? computerPlayer : humanPlayer;
  const ply = moveHistory.length;
  const cacheKey = searchContext
    ? transpositionKey(
        searchContext,
        depth,
        computerPlayer,
        moveHistory,
        progressTracker,
        tacticalExtension,
      )
    : null;
  const alphaAtEntry = alpha,
    betaAtEntry = beta;
  if (searchContext) {
    const entry = searchContext.table.get(
      cacheKey,
      blackBitboard,
      whiteBitboard,
      toMove,
    );
    if (entry) {
      searchContext.stats.hits++;
      const score = scoreFromTable(entry.score, ply);
      // Bounds can justify a cutoff, but are not exact answers inside the window.
      if (
        entry.flag === EXACT ||
        (entry.flag === LOWER_BOUND && score >= beta) ||
        (entry.flag === UPPER_BOUND && score <= alpha)
      ) {
        searchContext.stats.cutoffs++;
        return {
          score,
          move: entry.move ? { ...entry.move } : null,
          ...(progressTracker?.trackPV && entry.principalVariation
            ? {
                principalVariation:
                  entry.principalVariation?.map((move) => ({ ...move })) || [],
              }
            : {}),
        };
      }
    }
  }
  function remember(result, flag = null) {
    if (searchContext) {
      const bound =
        flag ||
        (result.score <= alphaAtEntry
          ? UPPER_BOUND
          : result.score >= betaAtEntry
            ? LOWER_BOUND
            : EXACT);
      searchContext.table.store(
        cacheKey,
        blackBitboard,
        whiteBitboard,
        toMove,
        {
          score: scoreToTable(result.score, ply),
          flag: bound,
          depth,
          move: result.move,
          principalVariation: result.principalVariation,
        },
      );
      searchContext.stats.stores++;
    }
    return result;
  }

  // Order wins and blocks for the player whose turn is being searched.
  const candidates = generateCandidateMoves(
    blackBitboard,
    whiteBitboard,
    isMaximizing ? computerPlayer : humanPlayer,
    evaluationState?.lineBitboards,
    evaluationState?.winningSquareBitboards,
  );
  if (candidates.length === 0) {
    return remember({ score: 0, move: null }, EXACT);
  }

  const limitedCandidates = selectSearchCandidates(
    candidates,
    depth,
    moveHistory,
    progressTracker?.principalVariation,
  );

  // A winning move ends the game one ply later; no child board or quiet
  // alternatives can improve on that win distance.
  if (limitedCandidates[0].tactical === 2) {
    const move = limitedCandidates[0];
    const winningPly = moveHistory.length + 1;
    return remember(
      {
        score: isMaximizing ? WIN_SCORE - winningPly : -WIN_SCORE + winningPly,
        move,
        ...(progressTracker?.trackPV ? { principalVariation: [move] } : {}),
      },
      EXACT,
    );
  }

  const state =
    evaluationState ||
    createIncrementalEvaluator(blackBitboard, whiteBitboard, computerPlayer);

  if (isMaximizing) {
    let maxEval = -Infinity;
    let bestMove = null;
    let bestVariation = [];

    for (let i = 0; i < limitedCandidates.length; i++) {
      const candidate = limitedCandidates[i];

      // Report progress for root level moves
      if (progressTracker && moveHistory.length === 0) {
        const progress = (i / limitedCandidates.length) * 80 + 10; // 10% to 90%
        progressTracker.reportProgress(Math.floor(progress));
      } else if (progressTracker && moveHistory.length === 1 && i % 3 === 0) {
        // Report less frequent progress for second level
        const rootProgress = 10 + (i / limitedCandidates.length) * 15;
        progressTracker.reportProgress(Math.floor(rootProgress));
      }

      // Make the move
      const newBlackBitboard = [...blackBitboard];
      const newWhiteBitboard = [...whiteBitboard];
      const position = candidate.row * BOARD_SIZE + candidate.col;
      const slot = Math.floor(position / 32);
      const bit = position % 32;

      if (computerPlayer === 'black') {
        newBlackBitboard[slot] |= 1 << bit;
      } else {
        newWhiteBitboard[slot] |= 1 << bit;
      }

      // Recursive call
      const newMoveHistory = [...moveHistory, candidate];

      const undo = state.makeMove(position, computerPlayer);
      searchContext?.hasher.toggleMove(position, computerPlayer);
      let evaluation;
      try {
        const run = (low, high) => minimaxAlphaBeta(
          newBlackBitboard,
          newWhiteBitboard,
          depth - 1,
          low,
          high,
          false,
          computerPlayer,
          humanPlayer,
          newMoveHistory,
          progressTracker,
          state,
          searchContext,
          tacticalExtension,
        );
        if (progressTracker?.usePvs !== false && i > 0 && depth > 1 &&
            Number.isFinite(alpha) && beta - alpha > 1) {
          evaluation = run(alpha, alpha + 1);
          if (evaluation.score > alpha && evaluation.score < beta)
            evaluation = run(alpha, beta);
        } else evaluation = run(alpha, beta);
      } finally {
        searchContext?.hasher.toggleMove(position, computerPlayer);
        state.undoMove(undo);
      }

      if (evaluation.score > maxEval) {
        maxEval = evaluation.score;
        bestMove = candidate;
        bestVariation = [candidate, ...(evaluation.principalVariation || [])];
      }

      alpha = Math.max(alpha, evaluation.score);
      if (beta <= alpha) {
        break; // Alpha-beta pruning
      }
    }

    return remember({
      score: maxEval,
      move: bestMove,
      ...(progressTracker?.trackPV
        ? { principalVariation: bestVariation }
        : {}),
    });
  } else {
    let minEval = Infinity;
    let bestMove = null;
    let bestVariation = [];

    for (let i = 0; i < limitedCandidates.length; i++) {
      const candidate = limitedCandidates[i];

      // Make the move
      const newBlackBitboard = [...blackBitboard];
      const newWhiteBitboard = [...whiteBitboard];
      const position = candidate.row * BOARD_SIZE + candidate.col;
      const slot = Math.floor(position / 32);
      const bit = position % 32;

      if (humanPlayer === 'black') {
        newBlackBitboard[slot] |= 1 << bit;
      } else {
        newWhiteBitboard[slot] |= 1 << bit;
      }

      // Recursive call
      const newMoveHistory = [...moveHistory, candidate];

      const undo = state.makeMove(position, humanPlayer);
      searchContext?.hasher.toggleMove(position, humanPlayer);
      let evaluation;
      try {
        const run = (low, high) => minimaxAlphaBeta(
          newBlackBitboard,
          newWhiteBitboard,
          depth - 1,
          low,
          high,
          true,
          computerPlayer,
          humanPlayer,
          newMoveHistory,
          progressTracker,
          state,
          searchContext,
          tacticalExtension,
        );
        if (progressTracker?.usePvs !== false && i > 0 && depth > 1 &&
            Number.isFinite(beta) && beta - alpha > 1) {
          evaluation = run(beta - 1, beta);
          if (evaluation.score > alpha && evaluation.score < beta)
            evaluation = run(alpha, beta);
        } else evaluation = run(alpha, beta);
      } finally {
        searchContext?.hasher.toggleMove(position, humanPlayer);
        state.undoMove(undo);
      }

      if (evaluation.score < minEval) {
        minEval = evaluation.score;
        bestMove = candidate;
        bestVariation = [candidate, ...(evaluation.principalVariation || [])];
      }

      beta = Math.min(beta, evaluation.score);
      if (beta <= alpha) {
        break; // Alpha-beta pruning
      }
    }

    return remember({
      score: minEval,
      move: bestMove,
      ...(progressTracker?.trackPV
        ? { principalVariation: bestVariation }
        : {}),
    });
  }
}

export function findBestMoveDeepSearch(
  blackBitboard,
  whiteBitboard,
  computerPlayer,
  humanPlayer,
  progressCallback,
  searchDepth = 8,
  {
    onIteration = () => {},
    useTranspositionTable = true,
    usePvs = true,
    transpositionTable,
    tacticalExtension = TACTICAL_EXTENSION_PLIES,
    preferredMove = null,
  } = {},
) {
  if (
    !Number.isInteger(tacticalExtension) ||
    tacticalExtension < 0 ||
    tacticalExtension > BOARD_SIZE * BOARD_SIZE
  )
    throw new RangeError(
      'Tactical extension must be an integer between 0 and 225',
    );
  if (getBitboardResult(blackBitboard, whiteBitboard)) return null;
  let bestMove = null;
  let principalVariation = preferredMove
    ? [{
        ...preferredMove,
        position: preferredMove.row * BOARD_SIZE + preferredMove.col,
      }]
    : [];
  const state = createIncrementalEvaluator(
    blackBitboard,
    whiteBitboard,
    computerPlayer,
  );
  const searchContext = useTranspositionTable
    ? createSearchContext(
        blackBitboard,
        whiteBitboard,
        computerPlayer,
        transpositionTable ? { table: transpositionTable } : {},
      )
    : null;
  for (let depth = 1; depth <= searchDepth; depth++) {
    const hitsBefore = searchContext?.stats.hits || 0;
    const cutoffsBefore = searchContext?.stats.cutoffs || 0;
    const tracker = {
      usePvs,
      trackPV: true,
      principalVariation,
      nodes: 0,
      lastProgress: 0,
      reportProgress(progress) {
        const overall = Math.floor(
          ((depth - 1 + progress / 100) / searchDepth) * 100,
        );
        if (overall > this.lastProgress) {
          this.lastProgress = overall;
          progressCallback?.(overall);
        }
      },
    };
    const result = minimaxAlphaBeta(
      blackBitboard,
      whiteBitboard,
      depth,
      -Infinity,
      Infinity,
      true,
      computerPlayer,
      humanPlayer,
      [],
      tracker,
      state,
      searchContext,
      tacticalExtension,
    );
    if (!result.move) break;
    bestMove = result.move;
    principalVariation = result.principalVariation || [];
    // Publish only fully completed depths; partial root searches are biased.
    onIteration({
      depth,
      move: bestMove,
      score: result.score,
      nodes: tracker.nodes,
      principalVariation,
      cacheHits: (searchContext?.stats.hits || 0) - hitsBefore,
      cacheCutoffs: (searchContext?.stats.cutoffs || 0) - cutoffsBefore,
      tableSize: searchContext?.table.size || 0,
    });
    progressCallback?.(Math.floor((depth / searchDepth) * 100));
    if (Math.abs(result.score) >= WIN_SCORE - BOARD_SIZE * BOARD_SIZE) break;
  }
  progressCallback?.(100);
  return bestMove;
}

export function selectSearchCandidates(
  candidates,
  depth,
  moveHistory = [],
  principalVariation = [],
) {
  // Winning now takes precedence over blocking. Without an immediate win,
  // a single opposing winning square is the only non-losing reply.
  const wins = candidates.filter((move) => move.tactical === 2);
  const blocks = candidates.filter((move) => move.tactical === 1);
  if (wins.length === 0 && blocks.length === 1) return blocks;
  const eligibleCandidates = wins.length ? wins : candidates;

  // Limit candidates based on depth to maintain performance
  const maxCandidates = Math.max(8, Math.floor(20 - depth * 2)); // Increased base candidates
  const tacticalCount = eligibleCandidates.filter(
    (candidate) => candidate.tactical,
  ).length;
  const limitedCandidates = eligibleCandidates.slice(
    0,
    Math.max(maxCandidates, tacticalCount),
  );

  // Search the previous iteration's principal variation first. Only follow it
  // while the current path matches; another branch is a different position.
  const pv = principalVariation;
  if (
    moveHistory.every((move, index) => move.position === pv[index]?.position)
  ) {
    const preferred = eligibleCandidates.find(
      (move) => move.position === pv[moveHistory.length]?.position,
    );
    if (preferred) {
      const index = limitedCandidates.findIndex(
        (move) => move.position === preferred.position,
      );
      if (index >= 0) limitedCandidates.splice(index, 1);
      else {
        const removable = limitedCandidates.findLastIndex(
          (move) => !move.tactical,
        );
        if (removable >= 0) limitedCandidates.splice(removable, 1);
      }
      limitedCandidates.unshift(preferred);
    }
  }

  return limitedCandidates;
}

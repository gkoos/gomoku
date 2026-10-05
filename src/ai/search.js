import { BOARD_SIZE } from '../core/constants.js';
import { WIN_SCORE } from './config.js';
import { checkWinCondition, getBitboardResult } from '../core/rules.js';
import { generateCandidateMoves } from './moves.js';
import { evaluatePosition } from './evaluation.js';

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

  // A win at the horizon is terminal, just like a win at any earlier ply.
  if (depth === 0) {
    return {
      score: evaluatePosition(
        blackBitboard,
        whiteBitboard,
        computerPlayer,
        humanPlayer,
      ),
      move: null,
    };
  }

  // Order wins and blocks for the player whose turn is being searched.
  const candidates = generateCandidateMoves(
    blackBitboard,
    whiteBitboard,
    isMaximizing ? computerPlayer : humanPlayer,
  );
  if (candidates.length === 0) {
    return { score: 0, move: null };
  }

  const limitedCandidates = selectSearchCandidates(
    candidates,
    depth,
    moveHistory,
    progressTracker?.principalVariation,
  );

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

      const evaluation = minimaxAlphaBeta(
        newBlackBitboard,
        newWhiteBitboard,
        depth - 1,
        alpha,
        beta,
        false,
        computerPlayer,
        humanPlayer,
        newMoveHistory,
        progressTracker,
      );

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

    return {
      score: maxEval,
      move: bestMove,
      ...(progressTracker?.trackPV
        ? { principalVariation: bestVariation }
        : {}),
    };
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

      const evaluation = minimaxAlphaBeta(
        newBlackBitboard,
        newWhiteBitboard,
        depth - 1,
        alpha,
        beta,
        true,
        computerPlayer,
        humanPlayer,
        newMoveHistory,
        progressTracker,
      );

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

    return {
      score: minEval,
      move: bestMove,
      ...(progressTracker?.trackPV
        ? { principalVariation: bestVariation }
        : {}),
    };
  }
}

export function findBestMoveDeepSearch(
  blackBitboard,
  whiteBitboard,
  computerPlayer,
  humanPlayer,
  progressCallback,
  searchDepth = 8,
  { onIteration = () => {} } = {},
) {
  if (getBitboardResult(blackBitboard, whiteBitboard)) return null;
  let bestMove = null;
  let principalVariation = [];
  for (let depth = 1; depth <= searchDepth; depth++) {
    const tracker = {
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
  // Limit candidates based on depth to maintain performance
  const maxCandidates = Math.max(8, Math.floor(20 - depth * 2)); // Increased base candidates
  const tacticalCount = candidates.filter(
    (candidate) => candidate.tactical,
  ).length;
  const limitedCandidates = candidates.slice(
    0,
    Math.max(maxCandidates, tacticalCount),
  );

  // Search the previous iteration's principal variation first. Only follow it
  // while the current path matches; another branch is a different position.
  const pv = principalVariation;
  if (
    moveHistory.every((move, index) => move.position === pv[index]?.position)
  ) {
    const preferred = candidates.find(
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

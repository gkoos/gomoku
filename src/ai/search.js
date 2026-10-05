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

  // Limit candidates based on depth to maintain performance
  const maxCandidates = Math.max(8, Math.floor(20 - depth * 2)); // Increased base candidates
  const tacticalCount = candidates.filter(
    (candidate) => candidate.tactical,
  ).length;
  const limitedCandidates = candidates.slice(
    0,
    Math.max(maxCandidates, tacticalCount),
  );

  if (isMaximizing) {
    let maxEval = -Infinity;
    let bestMove = null;

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
      }

      alpha = Math.max(alpha, evaluation.score);
      if (beta <= alpha) {
        break; // Alpha-beta pruning
      }
    }

    return { score: maxEval, move: bestMove };
  } else {
    let minEval = Infinity;
    let bestMove = null;

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
      }

      beta = Math.min(beta, evaluation.score);
      if (beta <= alpha) {
        break; // Alpha-beta pruning
      }
    }

    return { score: minEval, move: bestMove };
  }
}

export function findBestMoveDeepSearch(
  blackBitboard,
  whiteBitboard,
  computerPlayer,
  humanPlayer,
  progressCallback,
  searchDepth = 8,
) {
  const depth = searchDepth;

  if (progressCallback) progressCallback(5);

  // Create progress tracker
  const progressTracker = {
    lastReportedProgress: 0,
    reportProgress: function (progress) {
      if (progressCallback && progress >= this.lastReportedProgress + 2) {
        // Throttle updates
        this.lastReportedProgress = progress;
        progressCallback(Math.min(90, progress));
      }
    },
  };

  if (progressCallback) progressCallback(10);

  // Use minimax with alpha-beta pruning
  const result = minimaxAlphaBeta(
    blackBitboard,
    whiteBitboard,
    depth,
    -Infinity,
    Infinity,
    true,
    computerPlayer,
    humanPlayer,
    [], // empty move history
    progressTracker,
  );

  if (progressCallback) progressCallback(100);

  if (result && result.move) {
    return result.move;
  } else {
    return null;
  }
}

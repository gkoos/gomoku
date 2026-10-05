import { oppositeColor } from '../core/constants.js';

import { getBitboardResult, findLegalFallback } from '../core/rules.js';
import { generateCandidateMoves } from './moves.js';
import {
  selectOpenFourDefense,
  checkImmediateThreat,
  checkOpen4Threats,
  checkSimpleOpen3Threats,
  checkDoubleOpen3Threats,
} from './threats.js';
import {
  evaluateMoveEnhanced,
  evaluateStrategicPosition,
} from './evaluation.js';
import { findBestMoveDeepSearch } from './search.js';

export function findBestMoveAdaptive(
  blackBitboard,
  whiteBitboard,
  computerPlayer,
  humanPlayer,
  difficulty,
  progressCallback,
  searchOptions = {},
) {
  if (getBitboardResult(blackBitboard, whiteBitboard)) return null;
  if (progressCallback) progressCallback(10);

  // For hard difficulty, use deep minimax search with 8-ply
  if (difficulty === 'hard') {
    const deepMove = findBestMoveDeepSearch(
      blackBitboard,
      whiteBitboard,
      computerPlayer,
      humanPlayer,
      (progress) => {
        if (progressCallback) {
          const mappedProgress = 10 + (progress / 100) * 80;
          progressCallback(Math.floor(mappedProgress));
        }
      },
      8, // 8-ply depth for hard
      searchOptions,
    );

    if (deepMove) {
      if (progressCallback) progressCallback(100);
      return deepMove;
    }
    // Fallback to regular search if deep search fails
  }

  // For medium difficulty, use deep minimax search with 6-ply
  if (difficulty === 'medium') {
    const deepMove = findBestMoveDeepSearch(
      blackBitboard,
      whiteBitboard,
      computerPlayer,
      humanPlayer,
      (progress) => {
        if (progressCallback) {
          const mappedProgress = 10 + (progress / 100) * 80;
          progressCallback(Math.floor(mappedProgress));
        }
      },
      6, // 6-ply depth for medium
      searchOptions,
    );

    if (deepMove) {
      if (progressCallback) progressCallback(100);
      return deepMove;
    }
    // Fallback to regular search if deep search fails
  }

  const candidates = generateCandidateMoves(
    blackBitboard,
    whiteBitboard,
    computerPlayer,
  );
  if (candidates.length === 0) {
    return null;
  }

  if (progressCallback) progressCallback(30);

  // Score each candidate move with enhanced evaluation
  let bestMove = null;
  let bestScore = -Infinity;
  const moveScores = [];

  // Evaluate all candidates
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const score = evaluateMoveEnhanced(
      blackBitboard,
      whiteBitboard,
      candidate,
      computerPlayer,
      humanPlayer,
    );

    moveScores.push({ candidate, score });

    if (score > bestScore) {
      bestScore = score;
      bestMove = candidate;
    }

    // Update progress
    if (progressCallback && i % 5 === 0) {
      const progress = 30 + (i / candidates.length) * 60;
      progressCallback(Math.floor(progress));
    }
  }

  // For medium difficulty, consider multiple top moves
  if (difficulty === 'medium' && moveScores.length > 1) {
    // Sort by score and consider top moves
    moveScores.sort((a, b) => b.score - a.score);

    // If there are multiple moves with similar high scores, add strategic considerations
    const topScore = moveScores[0].score;
    const topMoves = moveScores.filter((m) => m.score >= topScore * 0.9);

    if (topMoves.length > 1) {
      // Among top moves, prefer those with better position characteristics
      let bestStrategicMove = topMoves[0];
      let bestStrategicScore = -Infinity;

      for (const move of topMoves) {
        const strategicScore = evaluateStrategicPosition(
          blackBitboard,
          whiteBitboard,
          move.candidate,
          computerPlayer,
        );
        if (strategicScore > bestStrategicScore) {
          bestStrategicScore = strategicScore;
          bestStrategicMove = move;
        }
      }

      bestMove = bestStrategicMove.candidate;
    }
  }

  if (progressCallback) progressCallback(100);
  return bestMove || candidates[0];
}

export async function findBestMove(
  blackBitboard,
  whiteBitboard,
  computerPlayer,
  humanPlayer,
  difficulty,
  progressCallback = () => {},
  searchOptions = {},
) {
  try {
    if (getBitboardResult(blackBitboard, whiteBitboard)) {
      progressCallback(100);
      return null;
    }

    // OPTIMIZATION: If this is the first move of the game, just place in center
    let totalStones = 0;
    for (let slot = 0; slot < 8; slot++) {
      const blackMask = blackBitboard[slot] >>> 0;
      const whiteMask = whiteBitboard[slot] >>> 0;
      const combinedMask = blackMask | whiteMask;

      // Count set bits in this slot
      let count = 0;
      for (let bit = 0; bit < 32; bit++) {
        if ((combinedMask & (1 << bit)) !== 0) {
          count++;
        }
      }
      totalStones += count;
    }

    // If board is empty, place first move in center immediately
    if (totalStones === 0) {
      progressCallback(100);
      return { row: 7, col: 7 }; // Center of 15x15 board
    }

    // Report progress
    progressCallback(2);

    // PRIORITY 1: AI wins with 5-in-a-row (Five - XXXXX)
    const aiWinMoves = checkImmediateThreat(
      blackBitboard,
      whiteBitboard,
      computerPlayer,
    );
    if (aiWinMoves.length > 0) {
      const winMove = aiWinMoves[0];
      progressCallback(100);
      return { row: winMove.row, col: winMove.col };
    }

    // PRIORITY 2: Block opponent's immediate winning threats (Five - XXXXX)
    progressCallback(4);
    const humanWinThreats = checkImmediateThreat(
      blackBitboard,
      whiteBitboard,
      humanPlayer,
    );
    if (humanWinThreats.length > 0) {
      progressCallback(100);
      return { row: humanWinThreats[0].row, col: humanWinThreats[0].col };
    }

    // PRIORITY 3: AI's Open Four (_XXXX_)
    progressCallback(6);
    const aiOpen4Threats = checkOpen4Threats(
      blackBitboard,
      whiteBitboard,
      computerPlayer,
    );
    if (aiOpen4Threats.length > 0) {
      const threat = aiOpen4Threats[0];
      progressCallback(100);
      return { row: threat.row, col: threat.col };
    }

    // PRIORITY 4: Prefer a winning counterattack, otherwise prevent an open four.
    progressCallback(8);
    const humanOpen4s = checkOpen4Threats(
      blackBitboard,
      whiteBitboard,
      humanPlayer,
    );
    if (humanOpen4s.length > 0) {
      const defense = selectOpenFourDefense(
        blackBitboard,
        whiteBitboard,
        computerPlayer,
        humanPlayer,
        humanOpen4s,
      );
      progressCallback(100);
      return defense;
    }

    // Blockable fours are scored/searched with other candidates, not returned blindly.

    // PRIORITY 7: AI's Double Three (2 × _XXX_)
    progressCallback(14);
    const aiDoubleOpen3s = checkDoubleOpen3Threats(
      blackBitboard,
      whiteBitboard,
      computerPlayer,
    );
    if (aiDoubleOpen3s.length > 0) {
      const threat = aiDoubleOpen3s[0];
      progressCallback(100);
      return { row: threat.row, col: threat.col };
    }

    // PRIORITY 8: Block opponent's Double Three (2 × _XXX_)
    progressCallback(16);
    const opponentDoubleOpen3s = checkDoubleOpen3Threats(
      blackBitboard,
      whiteBitboard,
      humanPlayer,
    );
    if (opponentDoubleOpen3s.length > 0) {
      const threat = opponentDoubleOpen3s[0];
      progressCallback(100);
      return { row: threat.row, col: threat.col };
    }

    // Easy uses open-three shortcuts; Medium and Hard compare them in search.
    if (difficulty === 'easy') {
      progressCallback(18);
      const aiOpen3s = checkSimpleOpen3Threats(
        blackBitboard,
        whiteBitboard,
        computerPlayer,
      );
      if (aiOpen3s.length > 0) {
        const threat = aiOpen3s[0];
        progressCallback(100);
        return { row: threat.row, col: threat.col };
      }
    }

    // Easy: prevent the opponent from creating an open four.
    if (difficulty === 'easy') {
      progressCallback(20);
      const opponentOpen3s = checkSimpleOpen3Threats(
        blackBitboard,
        whiteBitboard,
        humanPlayer,
      );
      if (opponentOpen3s.length > 0) {
        const threat = opponentOpen3s[0];

        progressCallback(100);
        return { row: threat.row, col: threat.col };
      }
    }

    // GENERAL DEEP SEARCH for remaining moves (difficulty-based depth)
    progressCallback(22);

    if (typeof findBestMoveAdaptive === 'function') {
      const bestMove = findBestMoveAdaptive(
        blackBitboard,
        whiteBitboard,
        computerPlayer,
        humanPlayer,
        difficulty,
        (progress) => {
          const mappedProgress = Math.min(95, 22 + (progress / 100) * 73);
          progressCallback(Math.floor(mappedProgress));
        },
        searchOptions,
      );

      if (bestMove) {
        progressCallback(100);
        return bestMove;
      }
    }

    // Fallback to candidate moves if everything else fails
    progressCallback(96);
    const availableMoves = generateCandidateMoves(
      blackBitboard,
      whiteBitboard,
      computerPlayer,
    );
    if (availableMoves.length > 0) {
      progressCallback(100);
      return { row: availableMoves[0].row, col: availableMoves[0].col };
    }

    progressCallback(100);
    return findLegalFallback(blackBitboard, whiteBitboard);
  } catch (error) {
    console.error('AI Worker error in findBestMove:', error);
    progressCallback(100);
    return findLegalFallback(blackBitboard, whiteBitboard);
  }
}

export function chooseMove(
  position,
  { difficulty = 'medium', onProgress = () => {}, onIteration = () => {} } = {},
) {
  return findBestMove(
    position.blackBitboard,
    position.whiteBitboard,
    position.toMove,
    oppositeColor(position.toMove),
    difficulty,
    onProgress,
    { onIteration },
  );
}

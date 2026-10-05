import { BOARD_SIZE } from '../core/constants.js';
import { MAX_STATIC_SCORE } from './config.js';
import { analyzeLinePattern } from './patterns.js';

export function evaluateMoveEnhanced(
  blackBitboard,
  whiteBitboard,
  move,
  computerPlayer,
  humanPlayer,
) {
  const { row, col } = move;
  let score = 0;

  // Start with candidate priority bonus
  score += (move.priority || 0) * 0.1;

  // Create test bitboards with the move played
  const computerBitboard =
    computerPlayer === 'black' ? blackBitboard : whiteBitboard;
  const opponentBitboard =
    computerPlayer === 'black' ? whiteBitboard : blackBitboard;
  const testComputerBitboard = [...computerBitboard];
  const position = row * BOARD_SIZE + col;
  const slot = Math.floor(position / 32);
  const bit = position % 32;
  testComputerBitboard[slot] |= 1 << bit;

  // Evaluate patterns in all directions
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];
  let maxLineScore = 0;
  let totalLineScore = 0;

  for (const [dRow, dCol] of directions) {
    const lineScore = evaluateLineEnhanced(
      testComputerBitboard,
      opponentBitboard,
      row,
      col,
      dRow,
      dCol,
    );
    maxLineScore = Math.max(maxLineScore, lineScore);
    totalLineScore += lineScore;
  }

  // Weight both the best line and total potential
  score += maxLineScore * 2 + totalLineScore * 0.5;

  // Defensive evaluation - check what opponent threats this move blocks
  const testOpponentBitboard = [...opponentBitboard];
  testOpponentBitboard[slot] |= 1 << bit; // Temporarily place opponent stone

  let blockedThreats = 0;
  for (const [dRow, dCol] of directions) {
    const opponentLineScore = evaluateLineEnhanced(
      testOpponentBitboard,
      computerBitboard,
      row,
      col,
      dRow,
      dCol,
    );
    if (opponentLineScore >= 1000) blockedThreats += opponentLineScore * 0.8; // Blocking bonus
  }
  score += blockedThreats;

  // Position quality bonuses
  score += evaluatePositionQuality(row, col, blackBitboard, whiteBitboard);

  return score;
}

export function evaluateLineEnhanced(
  playerBitboard,
  opponentBitboard,
  row,
  col,
  dRow,
  dCol,
) {
  const { stones, windows, winningMoves, openThree, openTwo } =
    analyzeLinePattern(playerBitboard, opponentBitboard, row, col, dRow, dCol);
  if (stones >= 5) return 100000;
  if (stones === 4) return winningMoves >= 2 ? 20000 : 10000;
  if (stones === 3) return openThree ? 2000 : 500;
  if (stones === 2) return openTwo ? 200 : 80;
  return stones === 1 ? 14 : 0;
}

export function evaluateStrategicPosition(
  blackBitboard,
  whiteBitboard,
  move,
  computerPlayer,
) {
  const { row, col } = move;
  let score = 0;

  // Center control bonus
  const centerDist = Math.abs(row - 7) + Math.abs(col - 7);
  score += (14 - centerDist) * 3;

  // Connectivity bonus - prefer positions that connect to existing stones
  let connectivity = 0;
  const computerBitboard =
    computerPlayer === 'black' ? blackBitboard : whiteBitboard;

  for (let dRow = -2; dRow <= 2; dRow++) {
    for (let dCol = -2; dCol <= 2; dCol++) {
      if (dRow === 0 && dCol === 0) continue;

      const newRow = row + dRow;
      const newCol = col + dCol;

      if (
        newRow >= 0 &&
        newRow < BOARD_SIZE &&
        newCol >= 0 &&
        newCol < BOARD_SIZE
      ) {
        const pos = newRow * BOARD_SIZE + newCol;
        const slot = Math.floor(pos / 32);
        const bit = pos % 32;

        if (slot < 8 && ((computerBitboard[slot] >>> 0) & (1 << bit)) !== 0) {
          const distance = Math.max(Math.abs(dRow), Math.abs(dCol));
          connectivity += distance === 1 ? 20 : distance === 2 ? 10 : 5;
        }
      }
    }
  }

  score += connectivity;

  // Flexibility bonus - positions that allow multiple future directions
  let flexibilityScore = 0;
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];

  for (const [dRow, dCol] of directions) {
    let spaceInDirection = 0;

    // Check both directions along this line
    for (let sign of [-1, 1]) {
      for (let i = 1; i <= 4; i++) {
        const newRow = row + dRow * i * sign;
        const newCol = col + dCol * i * sign;

        if (
          newRow >= 0 &&
          newRow < BOARD_SIZE &&
          newCol >= 0 &&
          newCol < BOARD_SIZE
        ) {
          const pos = newRow * BOARD_SIZE + newCol;
          const slot = Math.floor(pos / 32);
          const bit = pos % 32;

          if (slot < 8) {
            const blackBit = ((blackBitboard[slot] >>> 0) & (1 << bit)) !== 0;
            const whiteBit = ((whiteBitboard[slot] >>> 0) & (1 << bit)) !== 0;

            if (!blackBit && !whiteBit) {
              spaceInDirection++;
            } else {
              break; // Hit a stone
            }
          }
        } else {
          break; // Hit board edge
        }
      }
    }

    flexibilityScore += Math.min(spaceInDirection, 6) * 2;
  }

  score += flexibilityScore;

  return score;
}

export function evaluatePositionQuality(
  row,
  col,
  blackBitboard,
  whiteBitboard,
) {
  let score = 0;

  // Distance from center
  const centerDist = Math.abs(row - 7) + Math.abs(col - 7);
  score += (14 - centerDist) * 2;

  // Density in local area
  let localDensity = 0;
  for (let dRow = -2; dRow <= 2; dRow++) {
    for (let dCol = -2; dCol <= 2; dCol++) {
      if (dRow === 0 && dCol === 0) continue;

      const newRow = row + dRow;
      const newCol = col + dCol;

      if (
        newRow >= 0 &&
        newRow < BOARD_SIZE &&
        newCol >= 0 &&
        newCol < BOARD_SIZE
      ) {
        const pos = newRow * BOARD_SIZE + newCol;
        const slot = Math.floor(pos / 32);
        const bit = pos % 32;

        if (slot < 8) {
          const blackBit = ((blackBitboard[slot] >>> 0) & (1 << bit)) !== 0;
          const whiteBit = ((whiteBitboard[slot] >>> 0) & (1 << bit)) !== 0;
          if (blackBit || whiteBit) {
            localDensity++;
          }
        }
      }
    }
  }

  score += localDensity * 8;

  return score;
}

export function evaluatePosition(
  blackBitboard,
  whiteBitboard,
  computerPlayer,
  humanPlayer,
) {
  const computerBitboard =
    computerPlayer === 'black' ? blackBitboard : whiteBitboard;
  const opponentBitboard =
    computerPlayer === 'black' ? whiteBitboard : blackBitboard;

  let score = 0;

  // Evaluate all positions on the board
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const position = row * BOARD_SIZE + col;
      const slot = Math.floor(position / 32);
      const bit = position % 32;

      const hasComputer =
        slot < 8 && ((computerBitboard[slot] >>> 0) & (1 << bit)) !== 0;
      const hasOpponent =
        slot < 8 && ((opponentBitboard[slot] >>> 0) & (1 << bit)) !== 0;

      if (hasComputer) {
        score += evaluateStonePosition(
          computerBitboard,
          opponentBitboard,
          row,
          col,
          1,
        );
      } else if (hasOpponent) {
        score -= evaluateStonePosition(
          opponentBitboard,
          computerBitboard,
          row,
          col,
          1,
        );
      }
    }
  }

  // Heuristic totals must never outrank a terminal win or loss.
  return Math.max(-MAX_STATIC_SCORE, Math.min(MAX_STATIC_SCORE, score));
}

export function evaluateStonePosition(
  playerBitboard,
  opponentBitboard,
  row,
  col,
  multiplier,
) {
  let totalScore = 0;
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];

  for (const [dRow, dCol] of directions) {
    const lineScore = evaluateLinePattern(
      playerBitboard,
      opponentBitboard,
      row,
      col,
      dRow,
      dCol,
    );
    totalScore += lineScore * multiplier;
  }

  return totalScore;
}

export function evaluateLinePattern(
  playerBitboard,
  opponentBitboard,
  row,
  col,
  dRow,
  dCol,
) {
  return scoreLinePattern(
    analyzeLinePattern(playerBitboard, opponentBitboard, row, col, dRow, dCol),
  );
}

export function scoreLinePattern({
  stones,
  windows,
  winningMoves,
  openThree,
  openTwo,
}) {
  if (stones >= 5) return 100000;
  if (stones === 4) return winningMoves >= 2 ? 20000 : 10000;
  if (stones === 3) return openThree ? 1000 : 100;
  if (stones === 2) return openTwo ? 100 : 10;
  return stones === 1 ? Math.min(windows, 2) : 0;
}

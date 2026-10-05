import { BOARD_SIZE, BOARD_CELLS } from '../core/constants.js';

import { checkWinCondition } from '../core/rules.js';
import { evaluateMoveEnhanced } from './evaluation.js';
import { analyzeLinePattern } from './patterns.js';

const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

export function selectOpenFourDefense(
  blackBitboard,
  whiteBitboard,
  computerPlayer,
  humanPlayer,
  threats,
) {
  let bestMove = null;
  let fewestThreats = Infinity;
  let bestScore = -Infinity;
  for (let position = 0; position < BOARD_CELLS; position++) {
    const slot = Math.floor(position / 32);
    const mask = 1 << (position % 32);
    if (((blackBitboard[slot] | whiteBitboard[slot]) & mask) !== 0) continue;
    const blackTest = [...blackBitboard];
    const whiteTest = [...whiteBitboard];
    (computerPlayer === 'black' ? blackTest : whiteTest)[slot] |= mask;
    const opponent = humanPlayer === 'black' ? blackTest : whiteTest;
    const own = computerPlayer === 'black' ? blackTest : whiteTest;
    const row = Math.floor(position / BOARD_SIZE),
      col = position % BOARD_SIZE;
    // Two distinct winning squares cannot both be blocked on the next turn.
    // Count only lines through this move; winning squares on different lines
    // are distinct because their sole intersection is the occupied move.
    const winningReplies = DIRECTIONS.reduce(
      (count, [dr, dc]) =>
        count +
        analyzeLinePattern(own, opponent, row, col, dr, dc).winningMoves,
      0,
    );
    if (
      checkWinCondition(own, position) ||
      (winningReplies >= 2 &&
        checkImmediateThreat(blackTest, whiteTest, humanPlayer).length === 0)
    ) {
      return { row, col };
    }
    let remaining = 0;
    for (const threat of threats) {
      if (threat.position === position) continue;
      if (
        [
          [0, 1],
          [1, 0],
          [1, 1],
          [1, -1],
        ].some(([dRow, dCol]) =>
          hasOpen4PatternSimple(
            opponent,
            blackTest,
            whiteTest,
            threat.row,
            threat.col,
            dRow,
            dCol,
          ),
        )
      ) {
        remaining++;
      }
    }
    if (remaining > fewestThreats) continue;
    const move = {
      row: Math.floor(position / BOARD_SIZE),
      col: position % BOARD_SIZE,
    };
    const score = evaluateMoveEnhanced(
      blackBitboard,
      whiteBitboard,
      move,
      computerPlayer,
      humanPlayer,
    );
    if (remaining < fewestThreats || score > bestScore) {
      fewestThreats = remaining;
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove;
}

export function checkImmediateThreat(
  blackBitboard,
  whiteBitboard,
  playerColor,
) {
  const threatMoves = [];
  const targetBitboard =
    playerColor === 'black' ? blackBitboard : whiteBitboard;

  // Check each empty position on the board
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const position = row * BOARD_SIZE + col;
      const slot = Math.floor(position / 32);
      const bit = position % 32;

      if (slot >= 8) continue;

      // Skip if position is occupied
      const blackBit = ((blackBitboard[slot] >>> 0) & (1 << bit)) !== 0;
      const whiteBit = ((whiteBitboard[slot] >>> 0) & (1 << bit)) !== 0;
      if (blackBit || whiteBit) continue;

      // Test placing a stone here for the target player
      const testBitboard = [...targetBitboard];
      testBitboard[slot] |= 1 << bit;

      // Check if this would create a win (5 in a row)
      if (checkWinCondition(testBitboard, position)) {
        // This position completes a 5-in-a-row
        threatMoves.push({ row, col, position, priority: 'win' });
      }
    }
  }

  return threatMoves;
}

export function checkOpen4Threats(blackBitboard, whiteBitboard, playerColor) {
  const threatMoves = [];
  const targetBitboard =
    playerColor === 'black' ? blackBitboard : whiteBitboard;

  const directions = [
    [0, 1], // horizontal
    [1, 0], // vertical
    [1, 1], // diagonal \
    [1, -1], // diagonal /
  ];

  // Check each empty position on the board
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const position = row * BOARD_SIZE + col;
      const slot = Math.floor(position / 32);
      const bit = position % 32;

      if (slot >= 8) continue;

      // Skip if position is occupied
      const blackBit = ((blackBitboard[slot] >>> 0) & (1 << bit)) !== 0;
      const whiteBit = ((whiteBitboard[slot] >>> 0) & (1 << bit)) !== 0;
      if (blackBit || whiteBit) continue;

      // Check each direction for open 4 patterns
      for (const [dRow, dCol] of directions) {
        if (
          hasOpen4PatternSimple(
            targetBitboard,
            blackBitboard,
            whiteBitboard,
            row,
            col,
            dRow,
            dCol,
          )
        ) {
          threatMoves.push({ row, col, position, priority: 'open4' });
          break; // Found a threat, no need to check other directions
        }
      }
    }
  }

  return threatMoves;
}

export function hasOpen4PatternSimple(
  playerBitboard,
  blackBitboard,
  whiteBitboard,
  row,
  col,
  dRow,
  dCol,
) {
  // Helper function to check if position is empty
  const isEmpty = (r, c) => {
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return false;
    const pos = r * BOARD_SIZE + c;
    const slot = Math.floor(pos / 32);
    const bit = pos % 32;
    if (slot >= 8) return false;

    const blackBit = ((blackBitboard[slot] >>> 0) & (1 << bit)) !== 0;
    const whiteBit = ((whiteBitboard[slot] >>> 0) & (1 << bit)) !== 0;
    return !blackBit && !whiteBit;
  };

  // Test placing a stone at this position
  const testBitboard = [...playerBitboard];
  const position = row * BOARD_SIZE + col;
  const slot = Math.floor(position / 32);
  const bit = position % 32;
  testBitboard[slot] |= 1 << bit;

  // Count consecutive stones in both directions from the placed stone
  let count = 1; // The stone we just placed
  let positiveCount = 0;
  let negativeCount = 0;

  // Count in positive direction
  for (let i = 1; i < 5; i++) {
    const newRow = row + dRow * i;
    const newCol = col + dCol * i;

    if (
      newRow < 0 ||
      newRow >= BOARD_SIZE ||
      newCol < 0 ||
      newCol >= BOARD_SIZE
    )
      break;

    const pos = newRow * BOARD_SIZE + newCol;
    const newSlot = Math.floor(pos / 32);
    const newBit = pos % 32;

    if (newSlot < 8 && ((testBitboard[newSlot] >>> 0) & (1 << newBit)) !== 0) {
      count++;
      positiveCount++;
    } else {
      break;
    }
  }

  // Count in negative direction
  for (let i = 1; i < 5; i++) {
    const newRow = row - dRow * i;
    const newCol = col - dCol * i;

    if (
      newRow < 0 ||
      newRow >= BOARD_SIZE ||
      newCol < 0 ||
      newCol >= BOARD_SIZE
    )
      break;

    const pos = newRow * BOARD_SIZE + newCol;
    const newSlot = Math.floor(pos / 32);
    const newBit = pos % 32;

    if (newSlot < 8 && ((testBitboard[newSlot] >>> 0) & (1 << newBit)) !== 0) {
      count++;
      negativeCount++;
    } else {
      break;
    }
  }

  // If we have 4 or more consecutive stones, check if it's truly "open"
  if (count >= 4) {
    // An open four must have two empty ends, giving two distinct winning moves.
    // Check the positions immediately beyond our consecutive stones
    const positiveEnd = row + dRow * (positiveCount + 1);
    const positiveEndCol = col + dCol * (positiveCount + 1);
    const negativeEnd = row - dRow * (negativeCount + 1);
    const negativeEndCol = col - dCol * (negativeCount + 1);

    const positiveEndOpen = isEmpty(positiveEnd, positiveEndCol);
    const negativeEndOpen = isEmpty(negativeEnd, negativeEndCol);

    // Both ends must be extendable; one empty end is a closed four.
    // AND we have exactly 4 stones (not 5, which would be a win)
    return positiveEndOpen && negativeEndOpen && count === 4;
  }

  return false;
}

export function findSimple4Threats(blackBitboard, whiteBitboard, humanPlayer) {
  const threats = [];
  const humanBitboard = humanPlayer === 'black' ? blackBitboard : whiteBitboard;
  const opponentBitboard =
    humanPlayer === 'black' ? whiteBitboard : blackBitboard;

  // Helper function to check if a position has a human stone
  const hasHumanStone = (r, c) => {
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return false;
    const pos = r * BOARD_SIZE + c;
    const slot = Math.floor(pos / 32);
    const bit = pos % 32;
    return slot < 8 && ((humanBitboard[slot] >>> 0) & (1 << bit)) !== 0;
  };

  // Helper function to check if a position has an opponent stone
  const hasOpponentStone = (r, c) => {
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return false;
    const pos = r * BOARD_SIZE + c;
    const slot = Math.floor(pos / 32);
    const bit = pos % 32;
    return slot < 8 && ((opponentBitboard[slot] >>> 0) & (1 << bit)) !== 0;
  };

  // Helper function to check if a position is empty
  const isEmpty = (r, c) => {
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return false;
    const pos = r * BOARD_SIZE + c;
    const slot = Math.floor(pos / 32);
    const bit = pos % 32;
    const blackBit = ((blackBitboard[slot] >>> 0) & (1 << bit)) !== 0;
    const whiteBit = ((whiteBitboard[slot] >>> 0) & (1 << bit)) !== 0;
    return !blackBit && !whiteBit;
  };

  // Helper function to check if a position is blocked (opponent stone or board edge)
  const isBlocked = (r, c) => {
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return true; // Board edge
    return hasOpponentStone(r, c); // Opponent stone
  };

  // Check every empty position for 4-stone threat patterns
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (!isEmpty(row, col)) continue;

      // Check all 4 directions for potential 4-in-a-row completion
      const directions = [
        [0, 1],
        [1, 0],
        [1, 1],
        [1, -1],
      ];

      for (const [dRow, dCol] of directions) {
        // MUCH MORE CONSERVATIVE: Only look for immediate 4-in-a-row completions
        // Check if placing a stone here creates exactly 4 consecutive stones
        // and that pattern can be extended to 5

        let consecutiveStones = 1; // The stone we're placing
        let canExtendTo5 = false;

        // Count consecutive stones in positive direction
        let posCount = 0;
        for (let i = 1; i <= 4; i++) {
          if (hasHumanStone(row + dRow * i, col + dCol * i)) {
            posCount++;
            consecutiveStones++;
          } else {
            // Check if this position can be used to extend to 5
            if (i === posCount + 1 && isEmpty(row + dRow * i, col + dCol * i)) {
              canExtendTo5 = true;
            }
            break;
          }
        }

        // Count consecutive stones in negative direction
        let negCount = 0;
        for (let i = 1; i <= 4; i++) {
          if (hasHumanStone(row - dRow * i, col - dCol * i)) {
            negCount++;
            consecutiveStones++;
          } else {
            // Check if this position can be used to extend to 5
            if (i === negCount + 1 && isEmpty(row - dRow * i, col - dCol * i)) {
              canExtendTo5 = true;
            }
            break;
          }
        }

        // Only consider this a threat if:
        // 1. It creates exactly 4 or more consecutive stones
        // 2. The pattern can be extended to create 5-in-a-row
        // 3. It's not completely blocked on both ends
        if (consecutiveStones >= 4 && canExtendTo5) {
          // Additional verification: make sure we're not just filling a gap in a blocked pattern
          const leftmostPos = row - dRow * negCount;
          const leftmostCol = col - dCol * negCount;
          const rightmostPos = row + dRow * posCount;
          const rightmostCol = col + dCol * posCount;

          // Check that at least one end of the complete pattern is not blocked
          const leftEnd = leftmostPos - dRow;
          const leftEndCol = leftmostCol - dCol;
          const rightEnd = rightmostPos + dRow;
          const rightEndCol = rightmostCol + dCol;

          const leftEndBlocked = isBlocked(leftEnd, leftEndCol);
          const rightEndBlocked = isBlocked(rightEnd, rightEndCol);

          // Only add threat if at least one end is not blocked
          if (!leftEndBlocked || !rightEndBlocked) {
            threats.push({ row, col });
            break; // Found a threat in this direction, no need to check others
          }
        }
      }
    }
  }

  return threats;
}

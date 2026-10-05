import { BOARD_SIZE, BOARD_CELLS } from '../core/constants.js';

import { checkWinCondition } from '../core/rules.js';

export function generateCandidateMoves(
  blackBitboard,
  whiteBitboard,
  playerColor = 'black',
) {
  const candidates = [];
  const visited = new Map();
  const stonePositions = [];

  // Helper function to check if position is empty
  const isEmpty = (row, col) => {
    if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE)
      return false;
    const pos = row * BOARD_SIZE + col;
    const slot = Math.floor(pos / 32);
    const bit = pos % 32;
    const blackBit = ((blackBitboard[slot] >>> 0) & (1 << bit)) !== 0;
    const whiteBit = ((whiteBitboard[slot] >>> 0) & (1 << bit)) !== 0;
    return !blackBit && !whiteBit;
  };

  // Helper function to add candidate with priority score
  const addCandidate = (row, col, priority = 0) => {
    if (
      row >= 0 &&
      row < BOARD_SIZE &&
      col >= 0 &&
      col < BOARD_SIZE &&
      isEmpty(row, col)
    ) {
      const key = `${row},${col}`;
      const existing = visited.get(key);
      if (existing) {
        existing.priority = Math.max(existing.priority, priority);
      } else {
        const candidate = {
          row,
          col,
          position: row * BOARD_SIZE + col,
          priority,
        };
        visited.set(key, candidate);
        candidates.push(candidate);
      }
    }
  };

  // First pass: collect all stone positions efficiently
  for (let slot = 0; slot < 8; slot++) {
    const blackMask = blackBitboard[slot] >>> 0;
    const whiteMask = whiteBitboard[slot] >>> 0;
    const combinedMask = blackMask | whiteMask;

    if (combinedMask === 0) continue; // Skip empty slots

    for (let bit = 0; bit < 32; bit++) {
      if ((combinedMask & (1 << bit)) !== 0) {
        const position = slot * 32 + bit;
        if (position >= BOARD_CELLS) break;

        const row = Math.floor(position / BOARD_SIZE);
        const col = position % BOARD_SIZE;
        stonePositions.push({ row, col });
      }
    }
  }

  // If no stones on board, start from center with high priority
  if (stonePositions.length === 0) {
    addCandidate(7, 7, 1000); // Center of 15x15 board
    addCandidate(6, 6, 900);
    addCandidate(6, 7, 950);
    addCandidate(6, 8, 900);
    addCandidate(7, 6, 950);
    addCandidate(7, 8, 950);
    addCandidate(8, 6, 900);
    addCandidate(8, 7, 950);
    addCandidate(8, 8, 900);
    return candidates.sort((a, b) => b.priority - a.priority);
  }

  // Each stone contributes to the density of at most 25 board cells.
  // Counts include both colors and the center stone, matching the original scans.
  const neighborhoodDensity = new Uint8Array(BOARD_CELLS);
  for (const { row, col } of stonePositions) {
    for (
      let r = Math.max(0, row - 2);
      r <= Math.min(BOARD_SIZE - 1, row + 2);
      r++
    ) {
      for (
        let c = Math.max(0, col - 2);
        c <= Math.min(BOARD_SIZE - 1, col + 2);
        c++
      ) {
        neighborhoodDensity[r * BOARD_SIZE + c]++;
      }
    }
  }

  // Generate candidates around stones with smart distance and density scoring
  for (const stone of stonePositions) {
    const { row, col } = stone;

    // Immediate adjacency (distance 1) - highest priority
    for (let dRow = -1; dRow <= 1; dRow++) {
      for (let dCol = -1; dCol <= 1; dCol++) {
        if (dRow === 0 && dCol === 0) continue;

        const newRow = row + dRow;
        const newCol = col + dCol;

        // Off-board neighbors cannot become candidates.
        if (
          newRow < 0 ||
          newRow >= BOARD_SIZE ||
          newCol < 0 ||
          newCol >= BOARD_SIZE
        )
          continue;
        const density = neighborhoodDensity[newRow * BOARD_SIZE + newCol];

        // Priority: higher for denser areas and center positions
        const centerBonus = 14 - (Math.abs(newRow - 7) + Math.abs(newCol - 7));
        const priority = 100 + density * 20 + centerBonus;

        addCandidate(newRow, newCol, priority);
      }
    }

    // Extended range (distance 2) - lower priority, only in dense areas
    const localDensity = neighborhoodDensity[row * BOARD_SIZE + col];

    // Only add distance-2 candidates in areas with sufficient stone density
    if (localDensity >= 3) {
      for (let dRow = -2; dRow <= 2; dRow++) {
        for (let dCol = -2; dCol <= 2; dCol++) {
          if (Math.abs(dRow) <= 1 && Math.abs(dCol) <= 1) continue; // Skip already added
          if (dRow === 0 && dCol === 0) continue;

          const newRow = row + dRow;
          const newCol = col + dCol;

          // Lower priority for distance-2 moves
          const centerBonus =
            14 - (Math.abs(newRow - 7) + Math.abs(newCol - 7));
          const priority = 30 + localDensity * 5 + centerBonus;

          addCandidate(newRow, newCol, priority);
        }
      }
    }
  }

  // Classify tactics before either candidate limit. Every winning move is
  // adjacent to an existing stone, including completions of broken fours.
  const blackTest = [...blackBitboard];
  const whiteTest = [...whiteBitboard];
  let tacticalCount = 0;
  for (const candidate of candidates) {
    const slot = Math.floor(candidate.position / 32);
    const bit = candidate.position % 32;
    blackTest[slot] |= 1 << bit;
    whiteTest[slot] |= 1 << bit;
    const blackWins = checkWinCondition(blackTest, candidate.position);
    const whiteWins = checkWinCondition(whiteTest, candidate.position);
    blackTest[slot] = blackBitboard[slot];
    whiteTest[slot] = whiteBitboard[slot];
    const ownWin = playerColor === 'black' ? blackWins : whiteWins;
    const opponentWin = playerColor === 'black' ? whiteWins : blackWins;
    candidate.tactical = ownWin ? 2 : opponentWin ? 1 : 0;
    if (candidate.tactical) tacticalCount++;
  }

  // Wins precede blocks, which precede positional moves. Keep all tactics even
  // when they exceed the usual branching limit.
  candidates.sort((a, b) => b.tactical - a.tactical || b.priority - a.priority);
  const maxCandidates = stonePositions.length < 10 ? 30 : 50;
  return candidates.slice(0, Math.max(maxCandidates, tacticalCount));
}

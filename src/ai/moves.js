import { BOARD_SIZE, BOARD_CELLS } from '../core/constants.js';

import { createLineBitboards, findWinningSquares } from './line-bitboards.js';

export function generateCandidateMoves(
  blackBitboard,
  whiteBitboard,
  playerColor = 'black',
  lineBitboards = null,
  winningSquareBitboards = null,
) {
  const candidates = [];
  const visited = new Array(BOARD_CELLS);
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
      const position = row * BOARD_SIZE + col;
      const existing = visited[position];
      if (existing) {
        existing.priority = Math.max(existing.priority, priority);
      } else {
        const candidate = {
          row,
          col,
          position,
          priority,
        };
        visited[position] = candidate;
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
  const lines = winningSquareBitboards
    ? null
    : lineBitboards || createLineBitboards(blackBitboard, whiteBitboard);
  const blackWins =
    winningSquareBitboards?.black ||
    findWinningSquares(lines.black, lines.white);
  const whiteWins =
    winningSquareBitboards?.white ||
    findWinningSquares(lines.white, lines.black);
  const ownWins = playerColor === 'black' ? blackWins : whiteWins;
  const opponentWins = playerColor === 'black' ? whiteWins : blackWins;
  let tacticalCount = 0;
  for (const candidate of candidates) {
    const slot = candidate.position >>> 5;
    const bit = 1 << (candidate.position & 31);
    const ownWin = (ownWins[slot] & bit) !== 0;
    const opponentWin = (opponentWins[slot] & bit) !== 0;
    candidate.tactical = ownWin ? 2 : opponentWin ? 1 : 0;
    if (candidate.tactical) tacticalCount++;
  }

  // Wins precede blocks, which precede positional moves. Keep all tactics even
  // when they exceed the usual branching limit.
  candidates.sort((a, b) => b.tactical - a.tactical || b.priority - a.priority);
  const maxCandidates = stonePositions.length < 10 ? 30 : 50;
  return candidates.slice(0, Math.max(maxCandidates, tacticalCount));
}

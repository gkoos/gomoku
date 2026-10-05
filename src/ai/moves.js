import { BOARD_SIZE, BOARD_CELLS } from '../core/constants.js';

import { createLineBitboards, findWinningSquares } from './line-bitboards.js';

const ROW_MASK = (1 << BOARD_SIZE) - 1;
const SOURCE_COLUMNS = Array.from({ length: BOARD_SIZE }, (_, col) => {
  const start = Math.max(0, col - 2),
    end = Math.min(BOARD_SIZE - 1, col + 2);
  return ((1 << (end - start + 1)) - 1) << start;
});
const ADJACENT_COLUMNS = Array.from({ length: BOARD_SIZE }, (_, col) => {
  const start = Math.max(0, col - 1),
    end = Math.min(BOARD_SIZE - 1, col + 1);
  return ((1 << (end - start + 1)) - 1) << start;
});
const OFFSET_ORDER = new Uint8Array(25);
let order = 0;
for (let dr = -1; dr <= 1; dr++)
  for (let dc = -1; dc <= 1; dc++)
    if (dr || dc) OFFSET_ORDER[(dr + 2) * 5 + dc + 2] = order++;
for (let dr = -2; dr <= 2; dr++)
  for (let dc = -2; dc <= 2; dc++)
    if (Math.abs(dr) > 1 || Math.abs(dc) > 1)
      OFFSET_ORDER[(dr + 2) * 5 + dc + 2] = order++;

export function generateCandidateMoves(
  blackBitboard,
  whiteBitboard,
  playerColor = 'black',
  lineBitboards = null,
  winningSquareBitboards = null,
) {
  const candidates = [];
  const occupiedRows = new Uint16Array(BOARD_SIZE);
  const stones = [];
  for (let slot = 0; slot < 8; slot++) {
    let mask = blackBitboard[slot] | whiteBitboard[slot];
    if (slot === 7) mask &= 1;
    while (mask) {
      const position = slot * 32 + 31 - Math.clz32(mask & -mask);
      const row = Math.floor(position / BOARD_SIZE),
        col = position % BOARD_SIZE;
      occupiedRows[row] |= 1 << col;
      stones.push(position);
      mask &= mask - 1;
    }
  }
  if (!stones.length) {
    return [
      [7, 7, 1000],
      [6, 6, 900],
      [6, 7, 950],
      [6, 8, 900],
      [7, 6, 950],
      [7, 8, 950],
      [8, 6, 900],
      [8, 7, 950],
      [8, 8, 900],
    ]
      .map(([row, col, priority]) => ({
        row,
        col,
        position: row * BOARD_SIZE + col,
        priority,
      }))
      .sort((a, b) => b.priority - a.priority);
  }

  // Numeric density preserves the existing priority formula.
  const neighborhoodDensity = new Uint8Array(BOARD_CELLS);
  for (const position of stones) {
    const row = Math.floor(position / BOARD_SIZE),
      col = position % BOARD_SIZE;
    for (
      let r = Math.max(0, row - 2);
      r <= Math.min(BOARD_SIZE - 1, row + 2);
      r++
    )
      for (
        let c = Math.max(0, col - 2);
        c <= Math.min(BOARD_SIZE - 1, col + 2);
        c++
      )
        neighborhoodDensity[r * BOARD_SIZE + c]++;
  }
  const adjacentExpansion = new Uint16Array(BOARD_SIZE);
  const extendedExpansion = new Uint16Array(BOARD_SIZE);
  const denseRows = new Uint16Array(BOARD_SIZE);
  for (let row = 0; row < BOARD_SIZE; row++) {
    const occupied = occupiedRows[row];
    adjacentExpansion[row] =
      (occupied | (occupied << 1) | (occupied >>> 1)) & ROW_MASK;
    let sources = occupied,
      dense = 0;
    while (sources) {
      const col = 31 - Math.clz32(sources & -sources);
      if (neighborhoodDensity[row * BOARD_SIZE + col] >= 3) dense |= 1 << col;
      sources &= sources - 1;
    }
    denseRows[row] = dense;
    extendedExpansion[row] =
      (dense | (dense << 1) | (dense >>> 1) | (dense << 2) | (dense >>> 2)) &
      ROW_MASK;
  }
  const ranks = new Uint16Array(BOARD_CELLS);
  for (let row = 0; row < BOARD_SIZE; row++) {
    const adjacent =
      adjacentExpansion[row] |
      (adjacentExpansion[row - 1] || 0) |
      (adjacentExpansion[row + 1] || 0);
    const extended =
      extendedExpansion[row] |
      (extendedExpansion[row - 1] || 0) |
      (extendedExpansion[row + 1] || 0) |
      (extendedExpansion[row - 2] || 0) |
      (extendedExpansion[row + 2] || 0);
    let frontier = (adjacent | extended) & ~occupiedRows[row] & ROW_MASK;
    while (frontier) {
      const bit = frontier & -frontier,
        col = 31 - Math.clz32(bit);
      const position = row * BOARD_SIZE + col;
      const centerBonus = 14 - Math.abs(row - 7) - Math.abs(col - 7);
      let priority =
        adjacent & bit
          ? 100 + neighborhoodDensity[position] * 20 + centerBonus
          : 0;
      let firstRank = -1,
        extendedDensity = 0;
      if (adjacent & bit) {
        const radius = extended & bit ? 2 : 1;
        for (
          let r = Math.max(0, row - radius);
          r <= Math.min(BOARD_SIZE - 1, row + radius);
          r++
        ) {
          const nearRow = Math.abs(row - r) <= 1;
          const near = nearRow ? occupiedRows[r] & ADJACENT_COLUMNS[col] : 0;
          let distant = denseRows[r] & SOURCE_COLUMNS[col];
          if (nearRow) distant &= ~ADJACENT_COLUMNS[col];
          const sources = near | distant;
          if (!sources) continue;
          const c = 31 - Math.clz32(sources & -sources);
          firstRank =
            (r * BOARD_SIZE + c) * 24 +
            OFFSET_ORDER[(row - r + 2) * 5 + col - c + 2];
          break;
        }
        // A distance-two source has at most 16 density cells outside this
        // candidate's neighborhood. Thus its priority is at most 110+5D,
        // below the adjacent priority 100+20D for every D >= 1.
      } else {
        for (
          let r = Math.max(0, row - 2);
          r <= Math.min(BOARD_SIZE - 1, row + 2);
          r++
        ) {
          let sources = denseRows[r] & SOURCE_COLUMNS[col];
          if (firstRank < 0 && sources) {
            const c = 31 - Math.clz32(sources & -sources);
            firstRank =
              (r * BOARD_SIZE + c) * 24 +
              OFFSET_ORDER[(row - r + 2) * 5 + col - c + 2];
          }
          while (sources) {
            const c = 31 - Math.clz32(sources & -sources);
            const density = neighborhoodDensity[r * BOARD_SIZE + c];
            if (density > extendedDensity) extendedDensity = density;
            sources &= sources - 1;
          }
        }
        priority = 30 + extendedDensity * 5 + centerBonus;
      }
      ranks[position] = firstRank;
      candidates.push({ row, col, position, priority });
      frontier &= frontier - 1;
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
  candidates.sort(
    (a, b) =>
      b.tactical - a.tactical ||
      b.priority - a.priority ||
      ranks[a.position] - ranks[b.position],
  );
  const maxCandidates = stones.length < 10 ? 30 : 50;
  return candidates.slice(0, Math.max(maxCandidates, tacticalCount));
}

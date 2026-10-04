const BOARD_SIZE = 15;

export function getWinningLine(board, row, col) {
  const player = board[row]?.[col];
  if (!player) return null;
  for (const [dRow, dCol] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const positions = [[row, col]];
    for (const sign of [-1, 1]) {
      for (let step = 1; step < BOARD_SIZE; step++) {
        const r = row + sign * dRow * step;
        const c = col + sign * dCol * step;
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE || board[r][c] !== player) break;
        if (sign < 0) positions.unshift([r, c]);
        else positions.push([r, c]);
      }
    }
    if (positions.length >= 5) return positions.slice(0, 5);
  }
  return null;
}

export function getBoardResult(board) {
  if (board.length !== BOARD_SIZE || board.some(row => row.length !== BOARD_SIZE)) {
    return { invalid: true };
  }
  const winners = new Map();
  let emptyCells = 0;
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const player = board[row][col];
      if (player === null) {
        emptyCells++;
      } else if (player !== 'black' && player !== 'white') {
        return { invalid: true };
      } else if (!winners.has(player)) {
        const line = getWinningLine(board, row, col);
        if (line) winners.set(player, line);
      }
    }
  }
  if (winners.size > 1) return { invalid: true };
  if (winners.size === 1) {
    const [winner, winningPositions] = winners.entries().next().value;
    return { winner, winningPositions };
  }
  return emptyCells === 0 ? { draw: true } : null;
}

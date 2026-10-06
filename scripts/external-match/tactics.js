import { replay, winnerAfter } from '../selfplay/core.js';

// Literal-square reference, independent of bitboards and cached engine patterns.
export function winningSquares(board, color) {
  const result = [];
  for (let p = 0; p < 225; p++) if (!board[p]) {
    board[p] = color;
    if (winnerAfter(board, p)) result.push(p);
    board[p] = 0;
  }
  return result;
}

/** Verify a continuous-four witness. Quiet attacks require a broader proof. */
export function verifyForcingLine(prefix, attacker, pv) {
  const { board, terminal } = replay(prefix);
  if (terminal || (prefix.length % 2 ? 2 : 1) !== attacker) throw new Error('Invalid forcing-line start');
  const line = [];
  for (let i = 0; i < pv.length; i += 2) {
    const p = pv[i];
    if (!Number.isInteger(p) || p < 0 || p >= 225 || board[p]) throw new Error('Illegal forcing move');
    board[p] = attacker; line.push(p);
    if (winnerAfter(board, p) === attacker) return { proven: true, kind: 'five', line, plies: line.length };
    const threats = winningSquares(board, attacker), enemyWins = winningSquares(board, 3 - attacker);
    if (enemyWins.length) return { proven: false, reason: 'defender-can-win', line, enemyWins };
    if (threats.length >= 2) return { proven: true, kind: 'double-winning-square', line, winningSquares: threats, plies: line.length + 2 };
    if (threats.length !== 1) return { proven: false, reason: 'quiet-attack', line };
    if (pv[i + 1] !== threats[0]) return { proven: false, reason: 'missing-mandatory-reply', line, mandatory: threats[0] };
    board[threats[0]] = 3 - attacker; line.push(threats[0]);
  }
  return { proven: false, reason: 'incomplete-line', line };
}

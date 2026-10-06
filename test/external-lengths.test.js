import assert from 'node:assert/strict';
import test from 'node:test';
import { compareLengths, distribution, lengthStats } from '../scripts/external-match/lengths.js';

const game = (pair, played, winner = 'Rapfi', color = 'black') => ({ pair, index: 0,
  black: color === 'black' ? 'Gomoku' : 'Rapfi', white: color === 'white' ? 'Gomoku' : 'Rapfi',
  moves: [0, 15, 1, 16, ...Array.from({ length: played }, (_, i) => i + 30)],
  turns: Array.from({ length: played }, (_, i) => ({ player: (i % 2 === 0) === (color === 'black') ? 'Gomoku' : 'Rapfi' })),
  winningEngine: winner });

test('game length separates opening plies, own moves, results and colors', () => {
  const result = lengthStats([game(0, 6), game(1, 10, 'Rapfi', 'white'), game(2, 5, 'Gomoku')]);
  assert.equal(result.losses.totalPlies.mean, 12);
  assert.equal(result.losses.playedPlies.mean, 8);
  assert.equal(result.losses.gomokuMoves.mean, 4);
  assert.equal(result.wins.games, 1);
  assert.equal(result.lossesByColor.white.playedPlies.mean, 10);
  assert.equal(distribution([1, 4]).median, 2.5);
  assert.equal(distribution([]).mean, null);
});
test('paired loss comparison matches IDs and excludes converted wins', () => {
  const before = [game(0, 6), game(1, 10), game(2, 6), game(3, 8)];
  const after = [game(3, 8), game(2, 7, 'Gomoku'), game(1, 8), game(0, 10)];
  const result = compareLengths(before, after);
  assert.deepEqual(result.matchedLossDelta, { count: 3, mean: 2 / 3, median: 0, min: -2, max: 4, longer: 1, shorter: 1, unchanged: 1 });
  assert.equal(result.changedResults.length, 1);
  assert.equal(result.matchedLosses.length, 3);
});
test('length comparisons reject incompatible openings, colors and duplicate IDs', () => {
  const before = [game(0, 6)];
  assert.throws(() => compareLengths(before, []));
  assert.throws(() => compareLengths([...before, ...before], [...before, ...before]));
  assert.throws(() => compareLengths(before, [game(0, 6, 'Rapfi', 'white')]));
  const changed = game(0, 6); changed.moves[0] = 2;
  assert.throws(() => compareLengths(before, [changed]));
});

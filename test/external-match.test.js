import test from 'node:test';
import assert from 'node:assert/strict';
import { openingText, parseGames, validatePair, report } from '../scripts/external-match/core.js';
import { opening, replay } from '../scripts/selfplay/core.js';

const initial = [0, 15, 1, 16];
function game(black = 'Gomoku', white = 'Rapfi') {
  return `(;SZ[15]RU[0]PB[${black}]PW[${white}]RE[B+1]TE[Five in a row]
;B[aa]C[opening move];W[ab]C[opening move];B[ba]C[opening move];W[bb]C[opening move]
;B[ca]C[10ms];W[cb]C[20ms];B[da]C[30ms];W[db]C[40ms];B[ea]C[50ms])`;
}
test('external SGF pairs preserve axes, opening, colors, timings and results', () => {
  const games = parseGames(game() + game('Rapfi', 'Gomoku'), initial);
  validatePair(games);
  assert.deepEqual(games[0].moves, [0, 15, 1, 16, 2, 17, 3, 18, 4]);
  const stats = report(games);
  assert.equal(stats.wins, 1); assert.equal(stats.losses, 1); assert.equal(stats.score, 0.5);
  assert.equal(stats.timing.Gomoku.moves, 5); assert.equal(stats.timing.Gomoku.totalMilliseconds, 150);
  assert.equal(stats.byColor.black.wins, 1); assert.equal(stats.byColor.white.losses, 1);
});
test('external SGF accepts any named opponent beside our engine', () => {
  const games = parseGames(game('Gomoku', 'PentaZen') + game('PentaZen', 'Gomoku'), initial);
  validatePair(games);
  const stats = report(games);
  assert.equal(stats.wins, 1); assert.equal(stats.losses, 1); assert.equal(stats.score, 0.5);
  assert.equal(stats.timing.Gomoku.moves, 5); assert.equal(stats.timing.PentaZen.moves, 5);
  assert.equal(stats.byColor.white.losses, 1);
  assert.equal(stats.lossesForReview.length, 1);
});
test('external results reject illegal moves, wrong openings and forfeits', () => {
  for (const broken of [game().replace('B[ca]', 'B[aa]'), game().replace('RE[B+1]', 'RE[W+1]'),
    game().replace(';B[ea]C[50ms]', ''), game().replace('C[10ms]', 'C[no timing]'), game().slice(0, -1)]) {
    assert.throws(() => parseGames(broken, initial));
  }
  assert.throws(() => parseGames(game(), [0, 15, 2, 16]));
  assert.throws(() => validatePair(parseGames(game() + game(), initial)));
});
test('deterministic opening exports use manager center offsets', () => {
  for (let pair = 0; pair < 50; pair++) {
    const nums = openingText(43, pair).trim().split(/,\s*/).map(Number);
    const positions = [];
    for (let i = 0; i < nums.length; i += 2) positions.push((nums[i + 1] + 7) * 15 + nums[i] + 7);
    assert.deepEqual(positions, opening(43, pair));
    assert.equal(replay(positions).terminal, false);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WEIGHTS, parseWeights, opening, replay, winnerAfter, chooseMove, playGame } from '../scripts/selfplay/core.js';

test('seeded openings are legal, repeatable, and varied', () => {
  const seen = new Set();
  for (let pair = 0; pair < 100; pair++) {
    const moves = opening(42, pair);
    assert.deepEqual(moves, opening(42, pair));
    assert.equal(replay(moves).terminal, false);
    assert.equal(moves.length, 4);
    seen.add(JSON.stringify(moves));
  }
  assert.ok(seen.size > 90);
});

test('freestyle replay detects overlines and rejects occupied or post-win moves', () => {
  const board = new Uint8Array(225);
  for (const p of [30, 31, 32, 33, 34, 35]) board[p] = 1;
  assert.equal(winnerAfter(board, 33), 1);
  assert.throws(() => replay([0, 0]), /Illegal move/);
  assert.throws(() => replay([0, 15, 1, 16, 2, 17, 3, 18, 4, 50]), /Illegal move/);
  assert.equal(replay([0, 15, 1, 16, 2, 17, 3, 18, 4]).winner, 1);
  const edge = new Uint8Array(225);
  for (const p of [13, 14, 15, 16, 17]) edge[p] = 1;
  assert.equal(winnerAfter(edge, 15), null);
});

test('weights validate names and ranges and preserve defaults', () => {
  assert.deepEqual(parseWeights(), DEFAULT_WEIGHTS);
  assert.equal(parseWeights({ openThree: 1234 })[3], 1234);
  for (const value of [{ typo: 1 }, { openThree: -1 }, { openThree: 1.5 }, { openThree: 100001 }, []]) assert.throws(() => parseWeights(value));
});

function fakeEngine(illegal = false) {
  let freed = 0;
  return { get freed() { return freed; }, MoveEngine: {
    with_weights(b, w) {
      let move = 0;
      while (move < 225 && ((b[move >>> 5] | w[move >>> 5]) & (1 << (move & 31)))) move++;
      return { root_move: () => illegal ? 225 : move, free: () => freed++ };
    },
  } };
}

test('illegal engine output releases Wasm state', () => {
  const engine = fakeEngine(true);
  assert.throws(() => chooseMove(engine, new Uint8Array(225), true, 1, DEFAULT_WEIGHTS), /illegal move/);
  assert.equal(engine.freed, 1);
});

test('paired games swap engines and produce replayable terminal records', () => {
  const engines = { a: fakeEngine(), b: fakeEngine() };
  const config = { seed: 42, depth: 1, a: { weights: DEFAULT_WEIGHTS }, b: { weights: DEFAULT_WEIGHTS } };
  const a = playGame(engines, config, 0), b = playGame(engines, config, 1);
  assert.deepEqual(a.opening, b.opening);
  assert.equal(a.blackEngine, 'a');
  assert.equal(b.blackEngine, 'b');
  for (const game of [a, b]) {
    assert.equal(replay(game.moves).terminal, true);
    assert.equal(game.turns.length + game.opening.length, game.moves.length);
  }
});

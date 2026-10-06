import test from 'node:test';
import assert from 'node:assert/strict';
import { replay } from '../scripts/selfplay/core.js';
import { verifyForcingLine, winningSquares } from '../scripts/external-match/tactics.js';

test('reference winning squares include both endpoints and preserve the board', () => {
  const { board } = replay([111, 0, 112, 2, 113, 4, 114, 6]);
  const before = board.slice();
  assert.deepEqual(winningSquares(board, 1), [110, 115]);
  assert.deepEqual(board, before);
});
test('a forcing witness needs mandatory replies and rejects quiet attacks', () => {
  const prefix = [111, 0, 112, 2, 113, 4];
  const proof = verifyForcingLine(prefix, 1, [114]);
  assert.equal(proof.proven, true); assert.equal(proof.plies, 3);
  assert.equal(verifyForcingLine(prefix, 1, [224]).reason, 'quiet-attack');
  assert.throws(() => verifyForcingLine(prefix, 1, [111]));
});
test('a winning search PV containing a quiet attack is not a continuous-four proof', () => {
  const prefix = [66, 52, 38, 80, 83, 68, 84, 82, 54, 97, 67, 99, 70];
  const proof = verifyForcingLine(prefix, 2, [96, 98, 112, 51, 127, 142, 128, 64, 144]);
  assert.equal(proof.proven, false); assert.equal(proof.reason, 'quiet-attack');
  assert.deepEqual(proof.line, [96]);
});
test('baseline shortcut allows a double win while the counterattack forces a block', () => {
  const prefix = [126, 140, 127, 143, 141, 156, 155, 113, 128, 129, 97, 112, 124, 125, 96, 115];
  const proof = verifyForcingLine([...prefix, 157], 2, [114, 111, 116]);
  assert.equal(proof.proven, true);
  assert.deepEqual(proof.winningSquares, [111, 116]);
  assert.equal(proof.plies, 3);
  const attack = replay([...prefix, 111]).board;
  assert.deepEqual(winningSquares(attack, 1), [81]);
  assert.deepEqual(winningSquares(attack, 2), []);
});

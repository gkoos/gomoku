import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseMove } from '../src/ai/engine.js';
import { board2Bitboards } from '../src/core/bitboards.js';
import {
  checkImmediateThreat,
  checkOpen4Threats,
  selectOpenFourDefense,
} from '../src/ai/threats.js';

function position(color, transform = (r, c) => [r, c], fork = true) {
  const board = Array.from({ length: 15 }, () => Array(15).fill(null));
  const opponent = color === 'black' ? 'white' : 'black';
  const own = [
    [7, 5],
    [7, 6],
    [7, 7],
  ];
  if (fork) own.push([4, 8], [5, 8], [6, 8]);
  for (const [player, stones] of [
    [color, own],
    [
      opponent,
      [
        [7, 4],
        [3, 8],
        [10, 5],
        [10, 6],
        [10, 7],
        [0, 0],
      ],
    ],
  ]) {
    for (const [r, c] of stones) {
      const [row, col] = transform(r, c);
      board[row][col] = player;
    }
  }
  return { ...board2Bitboards(board), toMove: color };
}

function play(p, move, color) {
  const next = {
    blackBitboard: [...p.blackBitboard],
    whiteBitboard: [...p.whiteBitboard],
  };
  const index = move.row * 15 + move.col;
  next[color === 'black' ? 'blackBitboard' : 'whiteBitboard'][index >>> 5] |=
    1 << (index % 32);
  return next;
}

test('every difficulty chooses a winning fork before open-four defense, in both colors and orientations', async () => {
  for (const color of ['black', 'white']) {
    const opponent = color === 'black' ? 'white' : 'black';
    for (const transform of [
      (r, c) => [r, c],
      (r, c) => [r, 14 - c],
      (r, c) => [14 - r, c],
      (r, c) => [c, 14 - r],
    ]) {
      const p = position(color, transform);
      const snapshot = structuredClone(p);
      assert.equal(
        checkOpen4Threats(p.blackBitboard, p.whiteBitboard, opponent).length,
        2,
      );
      for (const difficulty of ['easy', 'medium', 'hard']) {
        const move = await chooseMove(p, { difficulty });
        assert.deepEqual([move.row, move.col], transform(7, 8));
        const attacked = play(p, move, color);
        const wins = checkImmediateThreat(
          attacked.blackBitboard,
          attacked.whiteBitboard,
          color,
        );
        assert.equal(wins.length, 2);
        assert.equal(
          checkImmediateThreat(
            attacked.blackBitboard,
            attacked.whiteBitboard,
            opponent,
          ).length,
          0,
        );
        for (const block of wins) {
          const defended = play(attacked, block, opponent);
          assert.equal(
            checkImmediateThreat(
              defended.blackBitboard,
              defended.whiteBitboard,
              color,
            ).length,
            1,
          );
        }
        assert.deepEqual(p, snapshot);
      }
    }
  }
});

test('a single blockable four does not displace a necessary open-four defense', async () => {
  for (const color of ['black', 'white']) {
    const opponent = color === 'black' ? 'white' : 'black';
    const p = position(color, undefined, false);
    for (const difficulty of ['easy', 'medium', 'hard']) {
      const move = await chooseMove(p, { difficulty });
      assert.equal(move.row, 10);
      assert.ok(move.col === 4 || move.col === 8);
      const defended = play(p, move, color);
      assert.equal(
        checkOpen4Threats(
          defended.blackBitboard,
          defended.whiteBitboard,
          opponent,
        ).length,
        0,
      );
    }
  }
});

test('a fork cannot override an opponent win on the next move', async () => {
  const p = position('black');
  for (const col of [1, 2, 3]) {
    const next = play(p, { row: 0, col }, 'white');
    p.whiteBitboard = next.whiteBitboard;
  }
  const threats = checkOpen4Threats(p.blackBitboard, p.whiteBitboard, 'white');
  const move = selectOpenFourDefense(
    p.blackBitboard,
    p.whiteBitboard,
    'black',
    'white',
    threats,
  );
  assert.notDeepEqual(move, { row: 7, col: 8 });
  for (const difficulty of ['easy', 'medium', 'hard']) {
    const block = await chooseMove(p, { difficulty });
    assert.deepEqual(block, { row: 0, col: 4 });
  }
});

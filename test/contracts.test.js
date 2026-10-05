import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseMove } from '../src/ai/engine.js';
import { createWorkerHandler } from '../src/ai/worker-handler.js';
import { board2Bitboards } from '../src/core/bitboards.js';
import { getBoardResult, getBitboardResult } from '../src/core/rules.js';

test('position contract derives the opposing color and does not mutate input', async () => {
  const board = Array.from({ length: 15 }, () => Array(15).fill(null));
  for (let col = 0; col < 4; col++) board[0][col] = 'white';
  const position = { ...board2Bitboards(board), toMove: 'white' };
  const before = structuredClone(position);
  const move = await chooseMove(position, { difficulty: 'easy' });
  assert.deepEqual([move.row, move.col], [0, 4]);
  assert.deepEqual(position, before);
  const messages = [];
  const handle = createWorkerHandler({
    postMessage: (message) => messages.push(message),
    reportError: (...args) => assert.fail(String(args)),
  });
  await handle({
    data: {
      type: 'FIND_BEST_MOVE',
      requestId: 7,
      data: { position, difficulty: 'easy' },
    },
  });
  assert.deepEqual(messages.at(-1).move, move);
  assert.equal(messages.at(-1).requestId, 7);
});
test('array and bitboard rules agree on wins and ongoing positions', () => {
  for (const color of ['black', 'white'])
    for (const [dr, dc] of [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, -1],
    ]) {
      const board = Array.from({ length: 15 }, () => Array(15).fill(null));
      for (let step = 0; step < 5; step++) {
        board[5 + dr * step][7 + dc * step] = color;
        const { blackBitboard, whiteBitboard } = board2Bitboards(board);
        const arrayResult = getBoardResult(board),
          bitResult = getBitboardResult(blackBitboard, whiteBitboard);
        assert.equal(arrayResult?.winner, bitResult?.winner);
        assert.equal(Boolean(arrayResult), Boolean(bitResult));
      }
    }
});

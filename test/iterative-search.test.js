import assert from 'node:assert/strict';
import test from 'node:test';
import {
  selectSearchCandidates,
  findBestMoveDeepSearch,
  minimaxAlphaBeta,
} from '../src/ai/search.js';
import { chooseMove } from '../src/ai/engine.js';
import { createWorkerHandler } from '../src/ai/worker-handler.js';
import { board2Bitboards } from '../src/core/bitboards.js';
import { findSimple4Threats, checkImmediateThreat } from '../src/ai/threats.js';

test('iterative search publishes completed depths and a legal principal variation', () => {
  const board = Array.from({ length: 15 }, () => Array(15).fill(null));
  board[7][7] = 'white';
  const { blackBitboard: b, whiteBitboard: w } = board2Bitboards(board);
  const iterations = [],
    progress = [];
  const move = findBestMoveDeepSearch(
    b,
    w,
    'black',
    'white',
    (p) => progress.push(p),
    3,
    { onIteration: (r) => iterations.push(r) },
  );
  assert.deepEqual(
    iterations.map((r) => r.depth),
    [1, 2, 3],
  );
  assert.deepEqual(move, iterations.at(-1).move);
  for (const r of iterations) {
    assert.deepEqual(r.principalVariation[0], r.move);
    assert.ok(r.nodes > 0);
    const squares = new Set(r.principalVariation.map((m) => m.position));
    assert.equal(squares.size, r.principalVariation.length);
  }
  assert.equal(progress.at(-1), 100);
  assert.ok(progress.every((p, i) => i === 0 || p >= progress[i - 1]));
});

test('PV ordering preserves forced candidates and follows only matching paths', () => {
  const candidates = Array.from({ length: 12 }, (_, position) => ({
    position,
    tactical: position < 2 ? 1 : 0,
  }));
  const before = structuredClone(candidates);
  const chosen = selectSearchCandidates(candidates, 8, [], [candidates[11]]);
  assert.equal(chosen[0].position, 11);
  assert.ok(chosen.some((m) => m.position === 0));
  assert.ok(chosen.some((m) => m.position === 1));
  assert.equal(chosen.length, 8);
  assert.deepEqual(candidates, before);
  assert.deepEqual(
    selectSearchCandidates(
      candidates,
      8,
      [{ position: 99 }],
      [{ position: 98 }, candidates[11]],
    ),
    candidates.slice(0, 8),
  );
  const forced = candidates.map((m) => ({ ...m, tactical: 1 }));
  assert.equal(selectSearchCandidates(forced, 8, [], [forced[11]]).length, 12);
});

function forkPosition(color = 'black') {
  const board = Array.from({ length: 15 }, () => Array(15).fill(null));
  const other = color === 'black' ? 'white' : 'black';
  for (const [r, c] of [
    [0, 1],
    [0, 2],
    [0, 3],
    [7, 5],
    [7, 6],
    [7, 7],
    [4, 8],
    [5, 8],
    [6, 8],
  ])
    board[r][c] = color;
  for (const [r, c] of [
    [0, 0],
    [7, 4],
    [3, 8],
  ])
    board[r][c] = other;
  return { ...board2Bitboards(board), toMove: color };
}
test('a winning double four beats the first blockable three extension for every difficulty and color', async () => {
  for (const color of ['black', 'white']) {
    const p = forkPosition(color);
    assert.deepEqual(
      findSimple4Threats(p.blackBitboard, p.whiteBitboard, color)[0],
      { row: 0, col: 4 },
    );
    for (const difficulty of ['easy', 'medium', 'hard']) {
      const iterations = [];
      const move = await chooseMove(p, {
        difficulty,
        onIteration: (r) => iterations.push(r),
      });
      assert.deepEqual([move.row, move.col], [7, 8]);
      if (difficulty !== 'easy') {
        assert.equal(iterations.at(-1).depth, 3);
        assert.equal(iterations.at(-1).score, 999997);
      }
    }
  }
});
test('previous principal variation reduces searched nodes on a tactical fixture', () => {
  const p = forkPosition(),
    iterations = [];
  findBestMoveDeepSearch(
    p.blackBitboard,
    p.whiteBitboard,
    'black',
    'white',
    null,
    3,
    { onIteration: (r) => iterations.push(r) },
  );
  const tracker = { trackPV: true, nodes: 0, reportProgress() {} };
  const direct = minimaxAlphaBeta(
    p.blackBitboard,
    p.whiteBitboard,
    3,
    -Infinity,
    Infinity,
    true,
    'black',
    'white',
    [],
    tracker,
  );
  assert.equal(direct.score, iterations.at(-1).score);
  assert.ok(iterations.at(-1).nodes < tracker.nodes);
});
test('worker publishes completed depths with the original request ID before its final answer', async () => {
  const messages = [];
  const handle = createWorkerHandler({
    postMessage: (m) => messages.push(m),
    reportError: (...args) => assert.fail(String(args)),
  });
  await handle({
    data: {
      type: 'FIND_BEST_MOVE',
      requestId: 91,
      data: { position: forkPosition(), difficulty: 'medium' },
    },
  });
  const iterations = messages.filter((m) => m.type === 'SEARCH_ITERATION');
  assert.deepEqual(
    iterations.map((m) => m.depth),
    [1, 2, 3],
  );
  assert.ok(messages.every((m) => m.requestId === 91));
  assert.deepEqual(messages.at(-1).move, iterations.at(-1).move);
});
test('iterative deepening retains immediate wins and mandatory blocks', () => {
  const p = forkPosition();
  // Completing an existing four remains an immediate win at every depth.
  p.blackBitboard[0] |= 1 << 4;
  const iterations = [];
  const move = findBestMoveDeepSearch(
    p.blackBitboard,
    p.whiteBitboard,
    'black',
    'white',
    null,
    8,
    { onIteration: (r) => iterations.push(r) },
  );
  assert.deepEqual([move.row, move.col], [0, 5]);
  assert.equal(iterations.length, 1);
  const block = findBestMoveDeepSearch(
    p.blackBitboard,
    p.whiteBitboard,
    'white',
    'black',
    null,
    2,
  );
  assert.ok(
    checkImmediateThreat(p.blackBitboard, p.whiteBitboard, 'black').some(
      (m) => m.row === block.row && m.col === block.col,
    ),
  );
});

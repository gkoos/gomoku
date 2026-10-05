import assert from 'node:assert/strict';
import test from 'node:test';
import { minimaxAlphaBeta, selectSearchCandidates } from '../src/ai/search.js';
import { generateCandidateMoves } from '../src/ai/moves.js';
import { createIncrementalEvaluator } from '../src/ai/incremental-evaluation.js';
import { evaluatePosition } from '../src/ai/evaluation.js';
import { WIN_SCORE } from '../src/ai/config.js';

const opposite = (color) => (color === 'black' ? 'white' : 'black');
function bitboard(stones = []) {
  const board = Array(8).fill(0);
  for (const [row, col] of stones) {
    const p = row * 15 + col;
    board[p >>> 5] |= 1 << (p % 32);
  }
  return board;
}
function boards(player, own, opponent) {
  return player === 'black'
    ? [bitboard(own), bitboard(opponent)]
    : [bitboard(opponent), bitboard(own)];
}
function run(
  black,
  white,
  depth,
  computer,
  maximizing = true,
  history = [],
  tracker = null,
  state = null,
) {
  return minimaxAlphaBeta(
    black,
    white,
    depth,
    -Infinity,
    Infinity,
    maximizing,
    computer,
    opposite(computer),
    history,
    tracker,
    state,
  );
}
function tracker() {
  return { nodes: 0, trackPV: true, reportProgress() {} };
}

test('immediate wins resolve without visiting children, for either side and perspective', () => {
  for (const player of ['black', 'white'])
    for (const maximizing of [true, false])
      for (const plies of [0, 3]) {
        const computer = maximizing ? player : opposite(player);
        const own = [
            [0, 0],
            [0, 1],
            [0, 2],
            [0, 3],
          ],
          other = [],
          history = [];
        for (let i = 0; i < plies; i++) {
          const color = (plies - 1 - i) % 2 === 0 ? opposite(player) : player;
          (color === player ? own : other).push([12, i]);
          history.push({ row: 12, col: i, position: 180 + i });
        }
        const [b, w] = boards(player, own, other),
          before = structuredClone([b, w]);
        const progress = tracker();
        const state = createIncrementalEvaluator(b, w, computer),
          originalScore = state.getScore();
        const result = run(
          b,
          w,
          4,
          computer,
          maximizing,
          history,
          progress,
          state,
        );
        assert.equal(result.move.position, 4);
        assert.equal(
          result.score,
          maximizing ? WIN_SCORE - plies - 1 : -WIN_SCORE + plies + 1,
        );
        assert.deepEqual(result.principalVariation, [result.move]);
        assert.equal(progress.nodes, 1);
        assert.equal(state.getScore(), originalScore);
        assert.deepEqual([b, w], before);
      }
});
test('a single mandatory block is the only explored root move, including at depth one', () => {
  for (const player of ['black', 'white'])
    for (const maximizing of [true, false]) {
      const computer = maximizing ? player : opposite(player);
      const [b, w] = boards(
        player,
        [
          [7, 4],
          [0, 0],
          [0, 1],
          [0, 2],
        ],
        [
          [7, 5],
          [7, 6],
          [7, 7],
          [7, 8],
        ],
      );
      const before = structuredClone([b, w]),
        progress = tracker();
      const state = createIncrementalEvaluator(b, w, computer),
        originalScore = state.getScore();
      const result = run(b, w, 1, computer, maximizing, [], progress, state);
      assert.equal(result.move.position, 114);
      assert.equal(progress.nodes, 2);
      const afterB = [...b],
        afterW = [...w];
      (player === 'black' ? afterB : afterW)[114 >>> 5] |= 1 << (114 % 32);
      assert.equal(
        result.score,
        evaluatePosition(afterB, afterW, computer, opposite(computer)),
      );
      assert.equal(state.getScore(), originalScore);
      assert.deepEqual([b, w], before);
    }
});
test('winning immediately takes precedence over an opposing immediate threat', () => {
  for (const player of ['black', 'white'])
    for (const maximizing of [true, false]) {
      const computer = maximizing ? player : opposite(player);
      const [b, w] = boards(
        player,
        [
          [0, 0],
          [0, 1],
          [0, 2],
          [0, 3],
          [7, 4],
        ],
        [
          [7, 5],
          [7, 6],
          [7, 7],
          [7, 8],
        ],
      );
      const result = run(b, w, 3, computer, maximizing, [], tracker());
      assert.equal(result.move.position, 4);
      assert.equal(result.score, maximizing ? WIN_SCORE - 1 : -WIN_SCORE + 1);
    }
});
test('PV ordering cannot reintroduce quiet moves into forced branches', () => {
  const quiet = { position: 8, tactical: 0 },
    block = { position: 9, tactical: 1 },
    win = { position: 10, tactical: 2 },
    otherWin = { position: 11, tactical: 2 };
  assert.deepEqual(selectSearchCandidates([block, quiet], 4, [], [quiet]), [
    block,
  ]);
  assert.deepEqual(
    selectSearchCandidates([win, otherWin, block, quiet], 4, [], [quiet]),
    [win, otherWin],
  );
  assert.deepEqual(
    selectSearchCandidates([win, otherWin, block, quiet], 4, [], [otherWin]),
    [otherWin, win],
  );
});
test('distinct opposing winning squares are not mistaken for a single forced block', () => {
  const [b, w] = boards(
    'black',
    [[0, 0]],
    [
      [7, 5],
      [7, 6],
      [7, 7],
      [7, 8],
    ],
  );
  const candidates = generateCandidateMoves(b, w, 'black');
  assert.equal(candidates.filter((m) => m.tactical === 1).length, 2);
  const selected = selectSearchCandidates(candidates, 4);
  assert.ok(selected.some((m) => m.tactical === 0));
  assert.equal(selected.filter((m) => m.tactical === 1).length, 2);
  const result = run(b, w, 2, 'black');
  assert.equal(result.score, -WIN_SCORE + 2);
});
test('mandatory blocks include broken fours, signed bits and the final board cell', () => {
  const cases = [
    {
      own: [[2, 5]],
      other: [
        [2, 0],
        [2, 1],
        [2, 3],
        [2, 4],
      ],
      target: 32,
    },
    {
      own: [[2, 6]],
      other: [
        [2, 2],
        [2, 3],
        [2, 4],
        [2, 5],
      ],
      target: 31,
    },
    {
      own: [[14, 9]],
      other: [
        [14, 10],
        [14, 11],
        [14, 12],
        [14, 13],
      ],
      target: 224,
    },
  ];
  for (const player of ['black', 'white'])
    for (const { own, other, target } of cases) {
      const [b, w] = boards(player, own, other),
        candidates = generateCandidateMoves(b, w, player);
      assert.deepEqual(
        candidates.filter((m) => m.tactical === 1).map((m) => m.position),
        [target],
      );
      assert.equal(run(b, w, 2, player).move.position, target);
    }
});
test('depth-zero resolves immediate wins and preserves existing terminal positions', () => {
  const b = bitboard([
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
    ]),
    w = bitboard();
  const horizon = run(b, w, 0, 'black');
  assert.equal(horizon.move.position, 4);
  assert.equal(horizon.score, WIN_SCORE - 1);
  b[0] |= 1 << 4;
  assert.deepEqual(run(b, w, 4, 'black'), { score: WIN_SCORE, move: null });
  assert.deepEqual(run(b, w, 4, 'white'), { score: -WIN_SCORE, move: null });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { minimaxAlphaBeta, findBestMoveDeepSearch } from '../src/ai/search.js';
import { createIncrementalEvaluator } from '../src/ai/incremental-evaluation.js';
import {
  createSearchContext,
  transpositionKey,
} from '../src/ai/search-context.js';
import { checkImmediateThreat } from '../src/ai/threats.js';
import { getBitboardResult } from '../src/core/rules.js';
import { evaluatePosition } from '../src/ai/evaluation.js';

function boards(own, other, color = 'black') {
  const b = Array(8).fill(0),
    w = Array(8).fill(0);
  for (const [board, stones] of [
    [color === 'black' ? b : w, own],
    [color === 'black' ? w : b, other],
  ])
    for (const [r, c] of stones) {
      const p = r * 15 + c;
      board[p >>> 5] |= 1 << (p & 31);
    }
  return [b, w];
}
function search(
  b,
  w,
  depth = 0,
  {
    computer = 'black',
    max = true,
    tracker = { nodes: 0, trackPV: true, reportProgress() {} },
    state = null,
    context = null,
    budget = 4,
    history = [],
  } = {},
) {
  return minimaxAlphaBeta(
    b,
    w,
    depth,
    -Infinity,
    Infinity,
    max,
    computer,
    computer === 'black' ? 'white' : 'black',
    history,
    tracker,
    state,
    context,
    budget,
  );
}
function chain() {
  return boards(
    [
      [7, 4],
      [4, 9],
      [5, 9],
      [6, 9],
      [8, 5],
      [5, 10],
      [6, 10],
      [7, 10],
      [9, 6],
    ],
    [
      [7, 5],
      [7, 6],
      [7, 7],
      [7, 8],
      [3, 9],
      [8, 6],
      [8, 7],
      [8, 8],
      [4, 10],
      [9, 7],
      [9, 8],
      [9, 9],
    ],
  );
}

test('horizon wins precede blocks and retain mate distance for both colors and perspectives', () => {
  for (const color of ['black', 'white'])
    for (const max of [true, false]) {
      const computer = max ? color : color === 'black' ? 'white' : 'black';
      const [b, w] = boards(
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
          [14, 14],
        ],
        color,
      );
      const result = search(b, w, 0, {
        computer,
        max,
        history: [{ row: 14, col: 14, position: 224 }],
      });
      assert.equal(result.move.position, 4);
      assert.equal(result.score, max ? 999998 : -999998);
    }
});

test('horizon mandatory blocks are evaluated after the reply, for both sides', () => {
  for (const color of ['black', 'white'])
    for (const max of [true, false]) {
      const computer = max ? color : color === 'black' ? 'white' : 'black';
      const [b, w] = boards(
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
        color,
      );
      const tracker = { nodes: 0, trackPV: true };
      const result = search(b, w, 0, { computer, max, tracker });
      assert.equal(result.move.position, 114);
      (color === 'black' ? b : w)[114 >>> 5] |= 1 << (114 & 31);
      assert.equal(result.score, evaluatePosition(b, w, computer));
      assert.equal(tracker.nodes, 2);
    }
});

test('two distinct opponent winning squares resolve a forced loss with a legal continuation', () => {
  for (const color of ['black', 'white'])
    for (const max of [true, false]) {
      const computer = max ? color : color === 'black' ? 'white' : 'black';
      const [b, w] = boards(
        [[0, 0]],
        [
          [7, 5],
          [7, 6],
          [7, 7],
          [7, 8],
        ],
        color,
      );
      const result = search(b, w, 0, { computer, max });
      assert.equal(result.score, max ? -999998 : 999998);
      for (let i = 0; i < result.principalVariation.length; i++) {
        const move = result.principalVariation[i],
          player = i === 0 ? color : color === 'black' ? 'white' : 'black';
        assert.equal(
          (b[move.position >>> 5] | w[move.position >>> 5]) &
            (1 << (move.position & 31)),
          0,
        );
        (player === 'black' ? b : w)[move.position >>> 5] |=
          1 << (move.position & 31);
      }
      assert.equal(
        getBitboardResult(b, w).winner,
        color === 'black' ? 'white' : 'black',
      );
    }
});

test('a forcing chain stops after the configured number of blocking moves', () => {
  for (const budget of [1, 2, 4, 5]) {
    const [b, w] = chain(),
      tracker = { nodes: 0, trackPV: true };
    const result = search(b, w, 0, { budget, tracker });
    assert.equal(result.principalVariation.length, budget);
    assert.equal(tracker.nodes, budget + 1);
    for (let i = 0; i < budget; i++) {
      const color = i % 2 ? 'white' : 'black',
        other = i % 2 ? 'black' : 'white',
        move = result.principalVariation[i];
      assert.equal(checkImmediateThreat(b, w, color).length, 0);
      assert.deepEqual(
        checkImmediateThreat(b, w, other).map((m) => m.position),
        [move.position],
      );
      (color === 'black' ? b : w)[move.position >>> 5] |=
        1 << (move.position & 31);
    }
    assert.equal(result.score, evaluatePosition(b, w, 'black'));
  }
});

test('quiet leaves skip tactical work and zero budget preserves fixed-horizon evaluation', () => {
  const [b, w] = boards([[7, 7]], []),
    state = {
      getScore: () => 123,
      hasImmediateThreat: () => false,
      makeMove: () => assert.fail('quiet leaf made a move'),
    };
  assert.deepEqual(search(b, w, 0, { state }), { score: 123, move: null });
  const [cb, cw] = chain();
  assert.deepEqual(search(cb, cw, 0, { budget: 0 }), {
    score: evaluatePosition(cb, cw, 'black'),
    move: null,
  });
});

test('extension hash and evaluator restore after a forced chain and an exception', () => {
  const [b, w] = chain(),
    state = createIncrementalEvaluator(b, w, 'black'),
    context = createSearchContext(b, w, 'black');
  const before = {
    key: context.hasher.key,
    score: state.getScore(),
    black: state.hasImmediateThreat('black'),
    white: state.hasImmediateThreat('white'),
  };
  search(b, w, 0, { state, context });
  assert.deepEqual(
    {
      key: context.hasher.key,
      score: state.getScore(),
      black: state.hasImmediateThreat('black'),
      white: state.hasImmediateThreat('white'),
    },
    before,
  );
  let calls = 0;
  const interrupted = {
    ...state,
    hasImmediateThreat(color) {
      if (++calls === 3) throw new Error('interrupted');
      return state.hasImmediateThreat(color);
    },
  };
  assert.throws(
    () => search(b, w, 0, { state: interrupted, context }),
    /interrupted/,
  );
  assert.deepEqual(
    {
      key: context.hasher.key,
      score: state.getScore(),
      black: state.hasImmediateThreat('black'),
      white: state.hasImmediateThreat('white'),
    },
    before,
  );
  assert.equal(context.table.size, 0);
});

test('cached normal searches cannot reuse values from another extension budget', () => {
  const [b, w] = chain(),
    context = createSearchContext(b, w, 'black');
  const quiet = search(b, w, 1, { context, budget: 0 });
  const extended = search(b, w, 1, { context, budget: 4 });
  assert.notEqual(quiet.score, extended.score);
  assert.deepEqual(extended, search(b, w, 1, { budget: 4 }));
  assert.notEqual(
    transpositionKey(context, 1, 'black', [], null, 0),
    transpositionKey(context, 1, 'black', [], null, 4),
  );
});

test('iterative search finds the missed depth-two forced win with and without caching', () => {
  const b = [0, 1048576, 1610743808, 4097, 1610614784, 1, 0, 0],
    w = [0, 2162688, 262170, -1073741816, 131072, 0, 0, 0];
  const old = search(b, w, 2, { budget: 0 });
  assert.equal(old.move.position, 66);
  const iterations = [];
  for (const useTranspositionTable of [false, true]) {
    iterations.length = 0;
    const move = findBestMoveDeepSearch(b, w, 'black', 'white', null, 2, {
      useTranspositionTable,
      onIteration: (r) => iterations.push(r),
    });
    assert.equal(move.position, 95);
    assert.equal(iterations.at(-1).score, 999997);
  }
});

test('incremental threat flags match direct detection throughout make and undo', () => {
  let seed = 141421;
  for (let sample = 0; sample < 20; sample++) {
    const b = Array(8).fill(0),
      w = Array(8).fill(0),
      state = createIncrementalEvaluator(b, w, 'black'),
      frames = [];
    function verify() {
      if (getBitboardResult(b, w)) return;
      for (const color of ['black', 'white'])
        assert.equal(
          state.hasImmediateThreat(color),
          checkImmediateThreat(b, w, color).length > 0,
        );
    }
    for (let i = 0; i < 100; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const p = seed % 225,
        s = p >>> 5,
        m = 1 << (p & 31);
      if ((b[s] | w[s]) & m) continue;
      const color = i % 2 ? 'white' : 'black';
      frames.push({ p, color, undo: state.makeMove(p, color) });
      (color === 'black' ? b : w)[s] |= m;
      verify();
      if (getBitboardResult(b, w)) break;
    }
    while (frames.length) {
      const { p, color, undo } = frames.pop();
      state.undoMove(undo);
      (color === 'black' ? b : w)[p >>> 5] &= ~(1 << (p & 31));
      verify();
    }
    assert.equal(state.getScore(), 0);
  }
});

test('deep-search options reject invalid extension budgets', () => {
  const [b, w] = boards([[7, 7]], []);
  for (const tacticalExtension of [-1, 0.5, 226, NaN])
    assert.throws(
      () =>
        findBestMoveDeepSearch(b, w, 'black', 'white', null, 1, {
          tacticalExtension,
        }),
      RangeError,
    );
});

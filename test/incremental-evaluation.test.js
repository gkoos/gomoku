import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createIncrementalEvaluator } from '../src/ai/incremental-evaluation.js';
import { evaluatePosition } from '../src/ai/evaluation.js';
import { minimaxAlphaBeta } from '../src/ai/search.js';
import { MAX_STATIC_SCORE } from '../src/ai/config.js';

function bits(positions = []) {
  const result = Array(8).fill(0);
  for (const p of positions) result[p >>> 5] |= 1 << (p % 32);
  return result;
}
function set(black, white, position, color, occupied) {
  const board = color === 'black' ? black : white,
    mask = 1 << (position % 32);
  if (occupied) board[position >>> 5] |= mask;
  else board[position >>> 5] &= ~mask;
}
function checkScore(state, black, white, perspective) {
  assert.equal(
    state.getScore(),
    evaluatePosition(
      black,
      white,
      perspective,
      perspective === 'black' ? 'white' : 'black',
    ),
  );
}
let seed = 0x3ab91;
function shuffle() {
  const squares = Array.from({ length: 225 }, (_, i) => i);
  for (let i = squares.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [squares[i], squares[j]] = [squares[j], squares[i]];
  }
  return squares;
}
for (const count of [0, 8, 24, 64, 120, 200])
  for (const perspective of ['black', 'white']) {
    test(
      'incremental scores match full evaluation through moves and undo: ' +
        count +
        '/' +
        perspective,
      () => {
        const squares = shuffle(),
          black = bits(squares.slice(0, count).filter((_, i) => i % 2 === 0)),
          white = bits(squares.slice(0, count).filter((_, i) => i % 2 === 1));
        const initialBlack = [...black],
          initialWhite = [...white];
        const state = createIncrementalEvaluator(black, white, perspective),
          history = [];
        checkScore(state, black, white, perspective);
        for (let i = count; i < Math.min(225, count + 24); i++) {
          const position = squares[i],
            color = i % 2 === 0 ? 'black' : 'white';
          const token = state.makeMove(position, color);
          set(black, white, position, color, true);
          history.push({ token, position, color });
          checkScore(state, black, white, perspective);
        }
        while (history.length) {
          const { token, position, color } = history.pop();
          state.undoMove(token);
          set(black, white, position, color, false);
          checkScore(state, black, white, perspective);
        }
        assert.deepEqual(black, initialBlack);
        assert.deepEqual(white, initialWhite);
        // Revisit a sibling move after the whole branch has been undone.
        const position = squares[count],
          token = state.makeMove(position, 'white');
        set(black, white, position, 'white', true);
        checkScore(state, black, white, perspective);
        state.undoMove(token);
        set(black, white, position, 'white', false);
        checkScore(state, black, white, perspective);
      },
    );
  }
test('incremental scoring handles edges, signed bits, all directions and both colors', () => {
  const positions = [
    0, 14, 210, 224, 31, 32, 63, 64, 95, 96, 127, 128, 159, 160, 191, 192, 112,
    111, 113, 110, 114, 97, 127, 82, 142, 96, 128, 80, 144, 98, 126, 84, 140,
  ];
  for (const perspective of ['black', 'white']) {
    const black = bits(),
      white = bits(),
      state = createIncrementalEvaluator(black, white, perspective),
      tokens = [];
    for (const [i, p] of [...new Set(positions)].entries()) {
      const color = i % 3 === 0 ? 'white' : 'black';
      tokens.push({ token: state.makeMove(p, color), p, color });
      set(black, white, p, color, true);
      checkScore(state, black, white, perspective);
    }
    for (const { token, p, color } of tokens.reverse()) {
      state.undoMove(token);
      set(black, white, p, color, false);
      checkScore(state, black, white, perspective);
    }
  }
});
test('blocking an opponent line updates scores anchored on existing stones', () => {
  const black = bits([109, 110, 111]),
    white = bits([107]);
  for (const perspective of ['black', 'white']) {
    const state = createIncrementalEvaluator(black, white, perspective);
    const before = state.getScore(),
      token = state.makeMove(112, 'white');
    const afterWhite = [...white];
    set(black, afterWhite, 112, 'white', true);
    checkScore(state, black, afterWhite, perspective);
    assert.notEqual(state.getScore(), before);
    state.undoMove(token);
    assert.equal(state.getScore(), before);
  }
});
test('the unclamped total survives saturation and undo', () => {
  const black = bits([
      ...Array.from({ length: 15 }, (_, i) => 90 + i),
      ...Array.from({ length: 9 }, (_, i) => i).filter((p) => p !== 4),
    ]),
    white = bits();
  const state = createIncrementalEvaluator(black, white, 'black');
  assert.equal(state.getScore(), MAX_STATIC_SCORE);
  const token = state.makeMove(4, 'white');
  set(black, white, 4, 'white', true);
  checkScore(state, black, white, 'black');
  assert.equal(state.getScore(), MAX_STATIC_SCORE);
  state.undoMove(token);
  set(black, white, 4, 'white', false);
  checkScore(state, black, white, 'black');
});
test('private board copies and rejected moves leave the evaluator unchanged', () => {
  const black = bits([31]),
    white = bits([224]),
    state = createIncrementalEvaluator(black, white, 'white');
  const before = state.getScore();
  assert.throws(() => state.makeMove(31, 'white'), /existing stone/);
  assert.throws(() => state.makeMove(225, 'black'), /outside/);
  assert.throws(() => state.makeMove(32, 'purple'), /Invalid player/);
  assert.equal(state.getScore(), before);
  const first = state.makeMove(32, 'black'),
    second = state.makeMove(63, 'white');
  assert.throws(() => state.undoMove(first), /reverse order/);
  state.undoMove(second);
  state.undoMove(first);
  assert.equal(state.getScore(), before);
  assert.deepEqual(black, bits([31]));
  assert.deepEqual(white, bits([224]));
});

// Independent reference adapter: move/undo bitboards, then rescan the full
// board at every leaf. Search itself keeps identical ordering and pruning.
function fullEvaluationState(black, white, perspective) {
  black = [...black];
  white = [...white];
  return {
    makeMove(position, color) {
      const board = color === 'black' ? black : white,
        slot = position >>> 5,
        before = board[slot];
      board[slot] |= 1 << (position % 32);
      return { board, slot, before };
    },
    undoMove({ board, slot, before }) {
      board[slot] = before;
    },
    getScore() {
      return evaluatePosition(
        black,
        white,
        perspective,
        perspective === 'black' ? 'white' : 'black',
      );
    },
  };
}
const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures/engine-baseline.json', import.meta.url)),
);
for (const fixture of fixtures.slice(0, 5))
  for (const perspective of ['black', 'white']) {
    test(
      'incremental search preserves full-evaluation score, move and tree: ' +
        fixture.name +
        '/' +
        perspective,
      () => {
        const other = perspective === 'black' ? 'white' : 'black';
        const makeTracker = () => ({
          nodes: 0,
          trackPV: true,
          reportProgress() {},
        });
        const cachedTracker = makeTracker(),
          referenceTracker = makeTracker();
        const cached = minimaxAlphaBeta(
          fixture.blackBitboard,
          fixture.whiteBitboard,
          4,
          -Infinity,
          Infinity,
          true,
          perspective,
          other,
          [],
          cachedTracker,
        );
        const reference = minimaxAlphaBeta(
          fixture.blackBitboard,
          fixture.whiteBitboard,
          4,
          -Infinity,
          Infinity,
          true,
          perspective,
          other,
          [],
          referenceTracker,
          fullEvaluationState(
            fixture.blackBitboard,
            fixture.whiteBitboard,
            perspective,
          ),
        );
        assert.deepEqual(cached, reference);
        assert.equal(cachedTracker.nodes, referenceTracker.nodes);
      },
    );
  }
test('search restores cached evaluation when a nested callback throws', () => {
  const black = bits([112]),
    white = bits([113]),
    state = createIncrementalEvaluator(black, white, 'black');
  const before = state.getScore();
  let calls = 0;
  assert.throws(
    () =>
      minimaxAlphaBeta(
        black,
        white,
        2,
        -Infinity,
        Infinity,
        true,
        'black',
        'white',
        [],
        {
          reportProgress() {
            if (++calls === 2) throw new Error('interrupted');
          },
        },
        state,
      ),
    /interrupted/,
  );
  assert.equal(state.getScore(), before);
  const reused = minimaxAlphaBeta(
    black,
    white,
    2,
    -Infinity,
    Infinity,
    true,
    'black',
    'white',
    [],
    null,
    state,
  );
  const fresh = minimaxAlphaBeta(
    black,
    white,
    2,
    -Infinity,
    Infinity,
    true,
    'black',
    'white',
  );
  assert.deepEqual(reused, fresh);
});

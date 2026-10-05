import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLineBitboards,
  createWinningSquareCache,
  findWinningSquares,
  getLineWindow,
  updateLineBitboards,
} from '../src/ai/line-bitboards.js';
import { createIncrementalEvaluator } from '../src/ai/incremental-evaluation.js';
import { checkImmediateThreat } from '../src/ai/threats.js';
import { generateCandidateMoves } from '../src/ai/moves.js';
import { minimaxAlphaBeta } from '../src/ai/search.js';
import { createSearchContext } from '../src/ai/search-context.js';

function put(board, p) {
  board[p >>> 5] |= 1 << (p & 31);
}
function has(board, p) {
  return (board[p >>> 5] & (1 << (p & 31))) !== 0;
}
function verify(state, b, w) {
  for (const color of ['black', 'white']) {
    const other = color === 'black' ? 'white' : 'black';
    assert.deepEqual(
      state.winningSquareBitboards[color],
      findWinningSquares(
        state.lineBitboards[color],
        state.lineBitboards[other],
      ),
    );
    const expected = checkImmediateThreat(b, w, color);
    assert.deepEqual(state.getWinningMoves(color), expected);
    assert.equal(state.hasImmediateThreat(color), expected.length > 0);
    assert.deepEqual(
      generateCandidateMoves(
        b,
        w,
        color,
        state.lineBitboards,
        state.winningSquareBitboards,
      ),
      generateCandidateMoves(b, w, color),
    );
  }
}

test('removing one crossing threat preserves a square still threatened by another line', () => {
  for (const color of ['black', 'white']) {
    const b = Array(8).fill(0),
      w = Array(8).fill(0),
      own = color === 'black' ? b : w;
    for (const p of [108, 109, 110, 111, 52, 67, 82]) put(own, p);
    const state = createIncrementalEvaluator(b, w, color),
      original = structuredClone(state.winningSquareBitboards);
    assert.equal(has(state.winningSquareBitboards[color], 112), true);
    const crossing = state.makeMove(97, color);
    put(own, 97);
    verify(state, b, w);
    const other = color === 'black' ? 'white' : 'black',
      opponent = other === 'black' ? b : w;
    const block = state.makeMove(112, other);
    put(opponent, 112);
    assert.equal(has(state.winningSquareBitboards[color], 112), false);
    verify(state, b, w);
    state.undoMove(block);
    opponent[112 >>> 5] &= ~(1 << (112 & 31));
    assert.equal(has(state.winningSquareBitboards[color], 112), true);
    state.undoMove(crossing);
    own[97 >>> 5] &= ~(1 << (97 & 31));
    assert.equal(has(state.winningSquareBitboards[color], 112), true);
    assert.deepEqual(state.winningSquareBitboards, original);
    verify(state, b, w);
  }
});

test('refresh reads only the four lines affected by the move for both colors', () => {
  const b = Array(8).fill(0),
    w = Array(8).fill(0),
    lines = createLineBitboards(b, w),
    reads = { black: new Set(), white: new Set() };
  for (const color of ['black', 'white'])
    lines[color] = new Proxy(lines[color], {
      get(target, key) {
        if (/^\d+$/.test(String(key))) reads[color].add(Number(key));
        return Reflect.get(target, key, target);
      },
    });
  const cache = createWinningSquareCache(lines);
  updateLineBitboards(lines, 112, 'black', true);
  reads.black.clear();
  reads.white.clear();
  cache.refresh(112);
  const expected = new Set(
    [0, 1, 2, 3].map((direction) => getLineWindow(112, direction).line),
  );
  assert.deepEqual(reads.black, expected);
  assert.deepEqual(reads.white, expected);
});

test('winning caches match full scans throughout dense make/undo sequences', () => {
  let seed = 271828;
  for (const perspective of ['black', 'white'])
    for (let sample = 0; sample < 8; sample++) {
      const b = Array(8).fill(0),
        w = Array(8).fill(0),
        state = createIncrementalEvaluator(b, w, perspective),
        frames = [];
      const identity = state.winningSquareBitboards;
      for (let i = 0; i < 150; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const p = seed % 225;
        if (has(b, p) || has(w, p)) continue;
        const color = i % 2 ? 'black' : 'white';
        frames.push({ p, color, token: state.makeMove(p, color) });
        put(color === 'black' ? b : w, p);
        verify(state, b, w);
        assert.equal(state.winningSquareBitboards, identity);
      }
      while (frames.length) {
        const { p, color, token } = frames.pop();
        state.undoMove(token);
        (color === 'black' ? b : w)[p >>> 5] &= ~(1 << (p & 31));
        verify(state, b, w);
      }
      assert.deepEqual(identity, {
        black: Array(8).fill(0),
        white: Array(8).fill(0),
      });
    }
});

test('cache masks handle signed words, broken fours and the final board cell', () => {
  for (const [stones, target] of [
    [[30, 31, 33, 34], 32],
    [[32, 33, 34, 35], 31],
    [[220, 221, 222, 223], 224],
  ]) {
    const b = Array(8).fill(0),
      w = Array(8).fill(0);
    for (const p of stones) put(b, p);
    const state = createIncrementalEvaluator(b, w, 'black');
    assert.equal(has(state.winningSquareBitboards.black, target), true);
    const token = state.makeMove(target, 'white');
    put(w, target);
    verify(state, b, w);
    assert.equal(has(state.winningSquareBitboards.black, target), false);
    state.undoMove(token);
    w[target >>> 5] &= ~(1 << (target & 31));
    verify(state, b, w);
    assert.equal(has(state.winningSquareBitboards.black, target), true);
  }
});

test('cached move results are independent and failed moves leave caches unchanged', () => {
  const b = Array(8).fill(0),
    w = Array(8).fill(0);
  for (const p of [0, 1, 2, 3]) put(b, p);
  const state = createIncrementalEvaluator(b, w, 'black'),
    before = structuredClone(state.winningSquareBitboards);
  const moves = state.getWinningMoves('black');
  moves[0].position = 224;
  moves.length = 0;
  assert.equal(state.getWinningMoves('black')[0].position, 4);
  assert.throws(() => state.makeMove(0, 'white'), /existing stone/);
  assert.throws(() => state.makeMove(-1, 'black'), RangeError);
  assert.deepEqual(state.winningSquareBitboards, before);
});

test('interrupted normal and tactical searches restore winning-square caches', () => {
  const b = Array(8).fill(0),
    w = Array(8).fill(0);
  put(b, 112);
  put(w, 113);
  const state = createIncrementalEvaluator(b, w, 'black'),
    context = createSearchContext(b, w, 'black'),
    before = structuredClone(state.winningSquareBitboards);
  let calls = 0;
  assert.throws(
    () =>
      minimaxAlphaBeta(
        b,
        w,
        3,
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
        context,
      ),
    /interrupted/,
  );
  assert.deepEqual(state.winningSquareBitboards, before);
  const cb = Array(8).fill(0),
    cw = Array(8).fill(0);
  for (const p of [109, 69, 84, 99]) put(cb, p);
  for (const p of [110, 111, 112, 113, 54]) put(cw, p);
  const forced = createIncrementalEvaluator(cb, cw, 'black'),
    snapshot = structuredClone(forced.winningSquareBitboards);
  const interrupted = { ...forced };
  let probes = 0;
  interrupted.hasImmediateThreat = (color) => {
    if (++probes > 2) throw new Error('tactical interruption');
    return forced.hasImmediateThreat(color);
  };
  assert.throws(
    () =>
      minimaxAlphaBeta(
        cb,
        cw,
        0,
        -Infinity,
        Infinity,
        true,
        'black',
        'white',
        [],
        null,
        interrupted,
      ),
    /tactical interruption/,
  );
  assert.deepEqual(forced.winningSquareBitboards, snapshot);
});

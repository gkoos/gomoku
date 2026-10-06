import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  initSync,
  SearchEngine,
  MoveEngine,
} from '../src/ai/wasm/gomoku_engine.js';
import {
  createWasmChooseMove,
  createWasmDeepSearch,
} from '../src/ai/wasm-search.js';
import { createWorkerHandler } from '../src/ai/worker-handler.js';
import { findBestMove, chooseMove } from '../src/ai/engine.js';
import { findBestMoveDeepSearch } from '../src/ai/search.js';
initSync({
  module: readFileSync(
    new URL('../src/ai/wasm/gomoku_engine_bg.wasm', import.meta.url),
  ),
});
const bits = (ps) => {
  const b = Array(8).fill(0);
  for (const p of ps) b[p >>> 5] |= 1 << (p & 31);
  return b;
};
const coords = (move) => move && [move.row, move.col];
test('custom Wasm weights preserve defaults and change static search scores', () => {
  const b = bits([112]), w = bits([113, 97]);
  const normal = new MoveEngine(b, w, true, 1, 4, 32768);
  const explicit = MoveEngine.with_weights(b, w, true, 1, 4, 32768, Int32Array.from([100000, 20000, 10000, 1000, 100, 100, 10, 1]));
  const zero = MoveEngine.with_weights(b, w, true, 1, 4, 32768, new Int32Array(8));
  try {
    assert.equal(normal.root_move(), -2);
    assert.deepEqual(explicit.next_depth(), normal.next_depth());
    const changed = zero.next_depth();
    assert.equal(changed[1], 0);
    assert.equal(changed[0], 1);
    assert.ok(changed[6] > 0);
    assert.notEqual(normal.next_depth()[1], 0);
  } finally { normal.free(); explicit.free(); zero.free(); }
  assert.throws(() => MoveEngine.with_weights(b, w, true, 1, 4, 32768, new Int32Array(7)));
  assert.throws(() => MoveEngine.with_weights(b, w, true, 1, 4, 32768, Int32Array.from([-1, 0, 0, 0, 0, 0, 0, 0])));
});
const nearlyFull = () => {
  const b = bits([]),
    w = bits([]);
  for (let p = 0; p < 224; p++)
    ((Math.floor(p / 15) + Math.floor((p % 15) / 2)) % 2 ? b : w)[p >>> 5] |=
      1 << (p & 31);
  return [b, w];
};

test('browser Wasm adapter preserves completed search results and frees its state', () => {
  const b = bits([112]),
    w = bits([113, 97]),
    before = structuredClone([b, w]),
    expected = [],
    actual = [];
  const js = findBestMoveDeepSearch(b, w, 'black', 'white', () => {}, 4, {
    onIteration: (r) => expected.push(r),
  });
  const result = createWasmDeepSearch(SearchEngine)(
    b,
    w,
    'black',
    'white',
    () => {},
    4,
    { onIteration: (r) => actual.push(r) },
  );
  const normalize = (r) => ({
    ...r,
    move: coords(r.move),
    principalVariation: r.principalVariation.map(coords),
  });
  assert.deepEqual(actual.map(normalize), expected.map(normalize));
  assert.deepEqual(coords(result), coords(js));
  assert.deepEqual([b, w], before);
  let freed = false;
  class Interrupted {
    next_depth() {
      return new Float64Array([1, 0, 1, 0, 0, 0, 1, 112]);
    }
    free() {
      freed = true;
    }
  }
  assert.throws(
    () =>
      createWasmDeepSearch(Interrupted)(
        bits([]),
        bits([]),
        'black',
        'white',
        () => {},
        2,
        {
          onIteration() {
            throw Error('interrupted');
          },
        },
      ),
    /interrupted/,
  );
  assert.equal(freed, true);
});

test('Wasm worker preserves every difficulty cap and request IDs', async () => {
  const [b, w] = nearlyFull();
  const before = structuredClone([b, w]);
  for (const [difficulty, cap] of [
    ['medium', 6],
    ['hard', 8],
    ['expert', 10],
  ]) {
    let loaded = 0;
    const messages = [],
      handle = createWorkerHandler({
        postMessage: (m) => messages.push(m),
        chooseMove: createWasmChooseMove({
          loadEngine: async () => {
            loaded++;
            return { MoveEngine };
          },
          reportError: assert.fail,
        }),
      });
    await handle({
      data: {
        type: 'FIND_BEST_MOVE',
        requestId: 42,
        data: {
          position: { blackBitboard: b, whiteBitboard: w, toMove: 'black' },
          difficulty,
        },
      },
    });
    assert.equal(loaded, 1);
    assert.ok(messages.every((m) => m.requestId === 42));
    assert.deepEqual(
      messages.filter((m) => m.type === 'SEARCH_ITERATION').map((m) => m.depth),
      Array.from({ length: cap }, (_, i) => i + 1),
    );
    assert.deepEqual(coords(messages.at(-1).move), [14, 14]);
    assert.equal(messages.at(-1).type, 'BEST_MOVE_FOUND');
  }
  assert.deepEqual([b, w], before);
});

test('root tactics and Easy scoring retain JavaScript behavior with Wasm enabled', async () => {
  const choose = createWasmChooseMove({
    loadEngine: async () => ({ MoveEngine }),
    reportError: assert.fail,
  });
  const cases = [
    [[0, 1, 2, 3], [112]],
    [[107], [108, 109, 110, 111]],
    [
      [110, 111, 112, 68, 83, 98],
      [109, 53, 155, 156, 157, 0],
    ],
    [[0, 1, 2, 3, 4], []],
    [[], []],
  ];
  for (const [black, white] of cases)
    for (const color of ['black', 'white'])
      for (const difficulty of ['easy', 'medium', 'hard', 'expert']) {
        const b = bits(black),
          w = bits(white);
        assert.deepEqual(
          coords(
            await choose(
              b,
              w,
              color,
              color === 'black' ? 'white' : 'black',
              difficulty,
              () => {},
            ),
          ),
          coords(
            await chooseMove(
              { blackBitboard: b, whiteBitboard: w, toMove: color },
              { difficulty },
            ),
          ),
        );
      }
});

test('failed initialization falls back once for every difficulty', async () => {
  let loads = 0;
  const errors = [];
  const choose = createWasmChooseMove({
    loadEngine: async () => {
      loads++;
      throw Error('offline');
    },
    reportError: (...e) => errors.push(e),
  });
  const [b, w] = nearlyFull();
  await choose(bits([]), bits([]), 'black', 'white', 'easy', () => {});
  assert.equal(loads, 1);
  const expected = await findBestMove(
    b,
    w,
    'black',
    'white',
    'medium',
    () => {},
  );
  for (let i = 0; i < 2; i++)
    assert.deepEqual(
      coords(await choose(b, w, 'black', 'white', 'medium', () => {})),
      coords(expected),
    );
  assert.equal(loads, 1);
  assert.equal(errors.length, 1);
});

test('complete Wasm move selection preserves searched iterations and shares initialization', async () => {
  const b = bits([112]),
    w = bits([113, 97]);
  let loads = 0;
  const choose = createWasmChooseMove({
    loadEngine: async () => {
      loads++;
      return { MoveEngine };
    },
    reportError: assert.fail,
  });
  const expected = [];
  const move = await findBestMove(b, w, 'black', 'white', 'medium', () => {}, {
    onIteration: (r) => expected.push(r),
  });
  const actual = [];
  assert.deepEqual(
    coords(
      await choose(b, w, 'black', 'white', 'medium', () => {}, {
        onIteration: (r) => actual.push(r),
      }),
    ),
    coords(move),
  );
  const normalize = (r) => ({
    ...r,
    move: coords(r.move),
    principalVariation: r.principalVariation.map(coords),
  });
  assert.deepEqual(actual.map(normalize), expected.map(normalize));
  await choose(bits([]), bits([]), 'black', 'white', 'easy', () => {});
  assert.equal(loads, 1);
});

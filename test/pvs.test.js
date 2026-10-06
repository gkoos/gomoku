import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { initSync, SearchEngine } from '../src/ai/wasm/gomoku_engine.js';
import { findBestMoveDeepSearch } from '../src/ai/search.js';
import { createSearchContext, transpositionKey } from '../src/ai/search-context.js';

initSync({ module: readFileSync(new URL('../src/ai/wasm/gomoku_engine_bg.wasm', import.meta.url)) });
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/engine-baseline.json', import.meta.url)));
const rust = (b, w, color, capacity, pvs) => {
  const engine = new SearchEngine(b, w, color === 'black', 3, 4, capacity);
  const iterations = [];
  try {
    engine.set_pvs(pvs);
    for (;;) {
      const result = engine.next_depth();
      if (!result.length) break;
      iterations.push({ depth: result[0], score: result[1], pv: Array.from(result.slice(7)) });
      assert.deepEqual(Array.from(engine.occupancy(true)), Array.from(b));
      assert.deepEqual(Array.from(engine.occupancy(false)), Array.from(w));
      assert.equal(engine.history_length(), 0);
    }
    assert.throws(() => engine.set_pvs(!pvs), /before search starts/);
  } finally { engine.free(); }
  return iterations;
};
const js = (b, w, color, capacity, usePvs) => {
  const iterations = [];
  findBestMoveDeepSearch(b, w, color, color === 'black' ? 'white' : 'black', null, 3, {
    usePvs, useTranspositionTable: capacity !== 0,
    onIteration: result => iterations.push({ depth: result.depth, score: result.score,
      pv: result.principalVariation.map(move => move.position) }),
  });
  return iterations;
};

test('PVS preserves completed scores, root moves and PVs against ordinary alpha-beta', () => {
  for (const fixture of fixtures.slice(0, 9)) {
    const b = Uint32Array.from(fixture.blackBitboard), w = Uint32Array.from(fixture.whiteBitboard);
    for (const color of ['black', 'white']) {
      for (const capacity of [0, 32768]) {
        const reference = rust(b, w, color, capacity, false);
        assert.deepEqual(rust(b, w, color, capacity, true), reference,
          `${fixture.name}/${color}/capacity=${capacity}`);
        assert.deepEqual(js(b, w, color, capacity, false), reference);
        assert.deepEqual(js(b, w, color, capacity, true), reference);
      }
    }
  }
});

test('PVS handles minimizing roots, bounds, tiny caches and extreme integer windows', () => {
  const fixture = fixtures.find(f => f.name === 'seeded-4');
  const b = Uint32Array.from(fixture.blackBitboard), w = Uint32Array.from(fixture.whiteBitboard);
  for (const maximizing of [true, false]) for (const [alpha, beta] of [
    [-2147483648, 2147483647], [-20, 20], [0, 1], [3000, 3001],
  ]) {
    const results = [];
    for (const pvs of [false, true]) {
      const engine = new SearchEngine(b, w, true, 4, 4, 2);
      try {
        engine.set_pvs(pvs);
        results.push(Array.from(engine.fixed_depth(4, maximizing, alpha, beta)));
        assert.deepEqual(Array.from(engine.occupancy(true)), Array.from(b));
        assert.deepEqual(Array.from(engine.occupancy(false)), Array.from(w));
        assert.equal(engine.history_length(), 0);
      } finally { engine.free(); }
    }
    const [reference, actual] = results;
    if (reference[1] <= alpha) assert.ok(actual[1] <= alpha);
    else if (reference[1] >= beta) assert.ok(actual[1] >= beta);
    else assert.deepEqual([actual[1], actual[7]], [reference[1], reference[7]]);
  }
});

test('JavaScript cache identity distinguishes PVS and ordinary alpha-beta', () => {
  const empty = Array(8).fill(0), context = createSearchContext(empty, empty, 'black');
  assert.notEqual(transpositionKey(context, 3, 'black', [], { usePvs: true }),
    transpositionKey(context, 3, 'black', [], { usePvs: false }));
});

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { findBestMoveDeepSearch } from '../src/ai/search.js';
const wasm = createRequire(import.meta.url)(
  '../engine-rust/pkg/nodejs/gomoku_engine.js',
);
const fixtures = JSON.parse(
  readFileSync(
    new URL('../test/fixtures/engine-baseline.json', import.meta.url),
  ),
);
const normalize = (r) => ({
  depth: r.depth,
  score: r.score,
  nodes: r.nodes,
  pv: r.principalVariation.map((m) => m.position),
});
function js(b, w, depth) {
  const out = [];
  findBestMoveDeepSearch(b, w, 'black', 'white', () => {}, depth, {
    onIteration: (r) => out.push(normalize(r)),
  });
  return out;
}
function rust(b, w, depth) {
  const s = new wasm.SearchEngine(b, w, true, depth, 4, 32768),
    out = [];
  try {
    for (;;) {
      const r = s.next_depth();
      if (!r.length) break;
      out.push({ depth: r[0], score: r[1], nodes: r[2], pv: [...r.slice(7)] });
    }
  } finally {
    s.free();
  }
  return out;
}
const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
for (const [name, depth] of [
  ['seeded-1', 6],
  ['seeded-4', 5],
]) {
  const f = fixtures.find((f) => f.name === name),
    b = Uint32Array.from(f.blackBitboard),
    w = Uint32Array.from(f.whiteBitboard);
  const expected = js(b, w, depth);
  assert.deepEqual(rust(b, w, depth), expected);
  for (let i = 0; i < 2; i++) {
    js(b, w, depth);
    rust(b, w, depth);
  }
  const times = { js: [], wasm: [] };
  for (let i = 0; i < 7; i++)
    for (const [key, run] of i % 2
      ? [
          ['wasm', rust],
          ['js', js],
        ]
      : [
          ['js', js],
          ['wasm', rust],
        ]) {
      const start = performance.now();
      const actual = run(b, w, depth);
      times[key].push(performance.now() - start);
      assert.deepEqual(actual, expected);
    }
  const j = median(times.js),
    r = median(times.wasm);
  console.log(
    `${name}, depth ${depth}: JS ${j.toFixed(1)} ms; Wasm ${r.toFixed(1)} ms; ${(j / r).toFixed(2)}x; identical iteration scores, node counts and PVs.`,
  );
}

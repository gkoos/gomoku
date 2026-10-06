import fs from 'node:fs';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const baseline = resolve(
  process.argv.find((a) => a.startsWith('--baseline='))?.slice(11) ??
    '.profiles/candidate-sort-before/gomoku_engine.js',
);
const old = require(baseline),
  now = require('../engine-rust/pkg/nodejs/gomoku_engine.js'),
  fixtures = require('../test/fixtures/engine-baseline.json');
const bits = (ps) => {
  const b = new Uint32Array(8);
  for (const p of ps) b[p >>> 5] |= 1 << (p & 31);
  return b;
};
fixtures.push(
  {
    name: 'mandatory-block',
    blackBitboard: bits([107]),
    whiteBitboard: bits([108, 109, 110, 111]),
  },
  {
    name: 'forcing-chain',
    blackBitboard: bits([109, 69, 84, 99, 125, 85, 100, 115, 141]),
    whiteBitboard: bits([
      110, 111, 112, 113, 54, 126, 127, 128, 70, 142, 143, 144,
    ]),
  },
);
const median = (a) => a.sort((a, b) => a - b)[a.length >> 1],
  results = [];
function search(m, b, w, d) {
  const s = new m.SearchEngine(b, w, true, d, 4, 32768),
    out = [];
  try {
    for (;;) {
      const r = s.next_depth();
      if (!r.length) break;
      out.push([...r]);
    }
  } finally {
    s.free();
  }
  return out;
}
for (const [name, depth] of [
  ['seeded-1', 7],
  ['seeded-2', 6],
  ['seeded-4', 6],
  ['seeded-9', 6],
  ['mandatory-block', 6],
  ['forcing-chain', 6],
]) {
  const f = fixtures.find((f) => f.name === name),
    b = Uint32Array.from(f.blackBitboard),
    w = Uint32Array.from(f.whiteBitboard),
    expected = search(old, b, w, depth);
  assert.deepEqual(search(now, b, w, depth), expected);
  for (let n = 0; n < 3; n++) {
    search(old, b, w, depth);
    search(now, b, w, depth);
  }
  const times = { old: [], now: [] };
  const batch =
    name === 'forcing-chain' ? 100 : name === 'mandatory-block' ? 20 : 1;
  for (let n = 0; n < 11; n++)
    for (const [key, m] of n % 2
      ? [
          ['now', now],
          ['old', old],
        ]
      : [
          ['old', old],
          ['now', now],
        ]) {
      const t = performance.now();
      let r;
      for (let i = 0; i < batch; i++) r = search(m, b, w, depth);
      times[key].push((performance.now() - t) / batch);
      assert.deepEqual(r, expected);
    }
  const a = median(times.old),
    z = median(times.now);
  results.push({ name, depth, batch, beforeMs: a, afterMs: z, speedup: a / z });
}
for (const r of results) console.log(JSON.stringify(r));
fs.mkdirSync('.profiles', { recursive: true });
fs.writeFileSync(
  '.profiles/wasm-search-comparison.json',
  JSON.stringify(
    {
      baseline,
      node: process.version,
      platform: process.platform,
      warmups: 3,
      timedRuns: 11,
      results,
    },
    null,
    2,
  ) + '\n',
);

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { findBestMove } from '../src/ai/engine.js';
const wasm = createRequire(import.meta.url)(
  '../engine-rust/pkg/nodejs/gomoku_engine.js',
);
const bits = (ps) => {
  const b = new Uint32Array(8);
  for (const p of ps) b[p >>> 5] |= 1 << (p & 31);
  return b;
};
const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
for (const [name, b, w, easy] of [
  ['open-four-defense', bits([112]), bits([153, 154, 155]), false],
  [
    'winning-counterattack',
    bits([110, 111, 112, 68, 83, 98]),
    bits([109, 53, 155, 156, 157, 0]),
    false,
  ],
  ['easy-opening', bits([112, 97, 128, 81]), bits([113, 96, 127, 82]), true],
]) {
  const js = async () => {
    const m = await findBestMove(
      b,
      w,
      'black',
      'white',
      easy ? 'easy' : 'expert',
      () => {},
      { deepSearch: () => ({ row: -1, col: 13 }) },
    );
    return m ? m.row * 15 + m.col : -1;
  };
  const rust = () => wasm.select_root(b, w, true, easy);
  const expected = await js();
  assert.equal(rust(), expected);
  for (let i = 0; i < 2; i++) {
    await js();
    rust();
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
      for (let n = 0; n < 20; n++) assert.equal(await run(), expected);
      times[key].push((performance.now() - start) / 20);
    }
  const j = median(times.js),
    r = median(times.wasm);
  console.log(
    `${name}: JS ${j.toFixed(3)} ms; Wasm ${r.toFixed(3)} ms; ${(j / r).toFixed(2)}x; identical root move.`,
  );
}

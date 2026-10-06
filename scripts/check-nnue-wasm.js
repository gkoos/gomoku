import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { SearchState } = createRequire(import.meta.url)('../engine-rust/pkg/nodejs/gomoku_engine.js');
const model = fs.readFileSync(process.argv[2]);
const fixtures = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
let maxError = 0;
for (const fixture of fixtures) {
  const black = new Uint32Array(8), white = new Uint32Array(8);
  for (const [board, stones] of [[black, fixture.black], [white, fixture.white]]) {
    for (const p of stones) board[p >>> 5] |= 1 << (p & 31);
  }
  const state = new SearchState(black, white, true);
  try {
    state.set_nnue(model, 1000);
    const probability = 1 / (1 + Math.exp(-state.nnue_logit(fixture.turn)));
    const error = Math.abs(probability - fixture.probability);
    maxError = Math.max(error, maxError);
    assert.ok(error < 1e-5, `NNUE probability mismatch: ${error}`);
  } finally { state.free(); }
}
console.log(JSON.stringify({ positions: fixtures.length, maximumProbabilityError: maxError }));

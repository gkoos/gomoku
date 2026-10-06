import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initSync, SearchState, MoveEngine } from '../src/ai/wasm/gomoku_engine.js';
initSync({ module: readFileSync(new URL('../src/ai/wasm/gomoku_engine_bg.wasm', import.meta.url)) });

function model() {
  const bytes = Buffer.alloc(24 + (454 * 4 + 1) * 4);
  bytes.write('GOMNNUE1');
  [1, 452, 4, 1].forEach((v, i) => bytes.writeUInt32LE(v, 8 + i * 4));
  for (let i = 0; i < 454 * 4 + 1; i++) bytes.writeFloatLE(Math.sin(i * 17) * .07, 24 + i * 4);
  return bytes;
}
function reference(bytes, stones, turn) {
  let result = bytes.readFloatLE(24 + 454 * 4 * 4);
  for (let h = 0; h < 4; h++) {
    let sum = bytes.readFloatLE(24 + (452 * 4 + h) * 4);
    for (const [p, black] of stones) sum += bytes.readFloatLE(24 + ((p + (black ? 0 : 225)) * 4 + h) * 4);
    sum += bytes.readFloatLE(24 + ((turn ? 450 : 451) * 4 + h) * 4);
    result += Math.max(0, Math.min(1, sum)) * bytes.readFloatLE(24 + (453 * 4 + h) * 4);
  }
  return result;
}
test('NNUE Wasm matches feature reference through full make/undo and both turns', () => {
  const bytes = model(), state = new SearchState(new Uint32Array(8), new Uint32Array(8), true);
  const stones = [], tokens = [], previous = [];
  try {
    state.set_nnue(bytes, 1000);
    for (const turn of [true, false]) {
      assert.equal(state.score_for_turn(turn), Math.round(state.nnue_logit(turn) * 1000 * (turn ? 1 : -1)));
    }
    for (let i = 0; i < 225; i++) {
      previous.push([state.nnue_logit(true), state.nnue_logit(false)]);
      const p = (i * 97) % 225, black = i % 2 === 0;
      tokens.push(state.make_move(p, black)); stones.push([p, black]);
      for (const turn of [true, false]) assert.ok(Math.abs(state.nnue_logit(turn) - reference(bytes, stones, turn)) < 1e-6);
    }
    assert.throws(() => state.set_nnue(bytes, 1000));
    for (let i = 224; i >= 0; i--) {
      state.undo_move(tokens[i]);
      assert.deepEqual([state.nnue_logit(true), state.nnue_logit(false)], previous[i]);
    }
    assert.throws(() => state.set_nnue(bytes.subarray(1), 1000));
    assert.throws(() => state.set_nnue(bytes, NaN));
    const bad = Buffer.from(bytes); bad.writeFloatLE(Infinity, 24);
    assert.throws(() => state.set_nnue(bad, 1000));
  } finally { state.free(); }
});
test('NNUE preserves exact root tactics and validates models before shortcuts', () => {
  const b = new Uint32Array(8), w = new Uint32Array(8);
  for (const p of [112,113,114,115]) b[p >>> 5] |= 1 << (p & 31);
  const engine = MoveEngine.with_nnue(b,w,true,1,4,32768,model(),1000);
  try { assert.ok([111,116].includes(engine.root_move())); } finally { engine.free(); }
  assert.throws(() => MoveEngine.with_nnue(b,w,true,1,4,32768,new Uint8Array(),1000));
});

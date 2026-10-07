import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { exportPolicy, POLICY_FEATURES } from '../src/ai/policy.js';

const wasm = createRequire(import.meta.url)('../engine-rust/pkg/nodejs/gomoku_engine.js');
const model = new Uint8Array(readFileSync(new URL('../public/models/policy-depth6.policy', import.meta.url)));
const zeroModel = exportPolicy({
  hidden: 1,
  input: new Array(POLICY_FEATURES).fill(0),
  bias: [0],
  output: [0],
  outputBias: 0,
});
const bits = (positions) => {
  const board = new Uint32Array(8);
  for (const p of positions) board[p >>> 5] |= 1 << (p & 31);
  return board;
};

function choose(black, white, computerBlack, loaded) {
  const engine = new wasm.MoveEngine(black, white, computerBlack, 2, 4, 32768);
  try {
    const root = engine.root_move();
    if (root !== -2) return { root, pv: [] };
    if (loaded) engine.set_policy(loaded, 1000, 1);
    let pv = [];
    for (;;) {
      const result = engine.next_depth();
      if (!result.length) break;
      pv = result.slice(7, 7 + result[6]);
    }
    return { root, pv: Array.from(pv) };
  } finally {
    engine.free();
  }
}

const cases = [
  [bits([112]), bits([113, 97]), false],
  [bits([112, 98, 82]), bits([113, 97, 83]), true],
  [bits([112]), bits([113]), false],
  [bits([0, 1, 2, 3]), bits([112]), false],
  [bits([110, 111, 112, 68, 83, 98]), bits([109, 53, 155, 156, 157, 0]), true],
];
let searched = 0;
for (const [black, white, computerBlack] of cases) {
  const plain = choose(black, white, computerBlack, null);
  const zero = choose(black, white, computerBlack, zeroModel);
  assert.deepEqual(zero, plain, 'a zero policy must equal no policy through the Wasm engine');
  const policy = choose(black, white, computerBlack, model);
  const repeat = choose(black, white, computerBlack, model);
  assert.deepEqual(repeat, policy, 'the policy search must be deterministic');
  assert.equal(policy.root, plain.root);
  if (plain.root === -2) {
    assert.ok(policy.pv.every((p) => Number.isInteger(p) && p >= 0 && p < 225));
    assert.ok(policy.pv.length >= 1);
    searched++;
  }
}
assert.throws(() => {
  const engine = new wasm.MoveEngine(bits([112]), bits([113, 97]), true, 2, 4, 32768);
  try {
    engine.set_policy(new Uint8Array([1, 2, 3]), 1000, 1);
  } finally {
    engine.free();
  }
}, 'a malformed model must be rejected');
console.log(
  `Policy Wasm engine passed: ${cases.length} boards, ${searched} searched, determinism, zero-policy neutrality, and model rejection.`,
);

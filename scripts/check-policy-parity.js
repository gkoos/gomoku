import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  candidateFeatures,
  boardCells,
  neighborhoodDensity,
  exportPolicy,
  loadPolicy,
  POLICY_FEATURES,
} from '../src/ai/policy.js';

const wasm = createRequire(import.meta.url)('../engine-rust/pkg/nodejs/gomoku_engine.js');

// Deterministic synthetic model so parity does not depend on a trained file.
const hidden = 6;
const bytes = exportPolicy({
  hidden,
  input: Float32Array.from({ length: POLICY_FEATURES * hidden }, (_, i) => Math.sin(i * 1.7) * 0.3),
  bias: Float32Array.from({ length: hidden }, (_, i) => ((i % 3) - 1) * 0.2),
  output: Float32Array.from({ length: hidden }, (_, i) => ((i % 5) - 2) * 0.15),
  outputBias: -0.1,
});
const policy = loadPolicy(bytes);
assert.equal(policy.hidden, hidden);
assert.throws(() => loadPolicy(bytes.subarray(1)));
assert.throws(() => loadPolicy(Uint8Array.from(bytes, (byte, i) => (i === 12 ? byte ^ 0xff : byte))));

let seed = 4242;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
const bitboard = (list) => {
  const board = new Uint32Array(8);
  for (const p of list) board[p >>> 5] |= 1 << (p & 31);
  return board;
};

let cases = 0;
function verify(blackList, whiteList, positions, sides) {
  const black = bitboard(blackList),
    white = bitboard(whiteList);
  const cells = boardCells(black, white);
  const density = neighborhoodDensity(cells);
  for (const position of positions)
    for (const side of sides)
      for (const [priority, tactical, ply] of [
        [30, 0, 0],
        [940, 0, 12],
        [1000, 2, 224],
        [255, 1, 41],
      ]) {
        const jsFeatures = candidateFeatures(cells, position, side, {
          priority,
          density: density[position],
          tactical,
          ply,
        });
        const rustFeatures = wasm.policy_features(
          black,
          white,
          position,
          side === 'black',
          priority,
          tactical,
          ply,
        );
        assert.equal(rustFeatures.length, POLICY_FEATURES);
        for (let i = 0; i < POLICY_FEATURES; i++)
          assert.ok(Math.abs(rustFeatures[i] - jsFeatures[i]) < 1e-6, `feature ${i} at ${position}`);
        const jsScore = policy.score(jsFeatures);
        const rustScore = wasm.policy_score(bytes, Float32Array.from(jsFeatures));
        assert.ok(Math.abs(rustScore - jsScore) < 1e-5, `score at ${position}`);
        cases++;
      }
}

const allPositions = Array.from({ length: 225 }, (_, i) => i);
verify([], [], allPositions, ['black', 'white']);
for (let p = 0; p < 225; p += 7) verify([p], [], allPositions, ['black', 'white']);
for (const count of [2, 3, 8, 24, 64, 120]) {
  for (let sample = 0; sample < 6; sample++) {
    const order = Array.from({ length: 225 }, (_, i) => i);
    for (let i = 224; i > 0; i--) {
      const j = random() % (i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    const black = [],
      white = [];
    for (let i = 0; i < count; i++) (i % 2 ? black : white).push(order[i]);
    verify(black, white, allPositions, ['black', 'white']);
  }
}
// Structured threats: equal-length runs and dense clusters exercise both roles.
verify([108, 109, 110], [153, 154, 155], allPositions, ['black', 'white']);
verify([0, 1, 15, 16], [2, 17, 30, 45], allPositions, ['black', 'white']);
// Tie the Rust forward pass to the committed Python-generated fixture.
const fixture = JSON.parse(
  fs.readFileSync(new URL('../test/fixtures/policy-forward.json', import.meta.url), 'utf8'),
);
const fixtureBytes = exportPolicy(fixture);
for (const { features, score } of fixture.cases)
  assert.ok(Math.abs(wasm.policy_score(fixtureBytes, Float32Array.from(features)) - score) < 1e-9);
console.log(
  `Policy Rust/Wasm parity passed: ${cases} feature/score cases across empty, single-stone, random, and structured boards for both colors.`,
);

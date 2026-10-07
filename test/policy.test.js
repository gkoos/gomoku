import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { exportPolicy, loadPolicy, POLICY_FEATURES } from '../src/ai/policy.js';

const fixture = JSON.parse(
  fs.readFileSync(new URL('./fixtures/policy-forward.json', import.meta.url), 'utf8'),
);

test('GOMPOL1 round-trips and reproduces the cross-language fixture', () => {
  const policy = loadPolicy(exportPolicy(fixture));
  assert.equal(policy.features, POLICY_FEATURES);
  assert.equal(policy.hidden, fixture.hidden);
  for (const { features, score } of fixture.cases)
    assert.ok(Math.abs(policy.score(features) - score) < 1e-9);
  assert.throws(() => policy.score(new Array(POLICY_FEATURES - 1).fill(0)));
});

test('loadPolicy rejects malformed models', () => {
  assert.throws(() => loadPolicy(new Uint8Array(4)));
  const bytes = exportPolicy({
    hidden: 2,
    input: new Array(POLICY_FEATURES * 2).fill(0.5),
    bias: [0, 0],
    output: [0, 0],
    outputBias: 0,
  });
  assert.throws(() => loadPolicy(bytes.subarray(0, bytes.length - 4)), /length/);
  const wrongWidth = bytes.slice();
  wrongWidth[12] ^= 0xff;
  assert.throws(() => loadPolicy(wrongWidth), /dimensions/);
  const nonFinite = exportPolicy({
    hidden: 1,
    input: new Array(POLICY_FEATURES).fill(0),
    bias: [0],
    output: [0],
    outputBias: 0,
  });
  new DataView(nonFinite.buffer).setFloat32(24, Number.POSITIVE_INFINITY, true);
  assert.throws(() => loadPolicy(nonFinite), /Non-finite/);
});

test('exportPolicy validates weight shapes', () => {
  assert.throws(() => exportPolicy({ hidden: 0, input: [], bias: [], output: [], outputBias: 0 }));
  assert.throws(() => exportPolicy({ hidden: 2, input: [0], bias: [0, 0], output: [0, 0], outputBias: 0 }));
});

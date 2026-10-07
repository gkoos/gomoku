import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { loadPolicy, createPolicyLoader, POLICY_FEATURES } from '../src/ai/policy.js';
import { POLICY_MODEL_URL, POLICY_SCALE, POLICY_PLIES } from '../src/ai/config.js';

const model = new Uint8Array(
  fs.readFileSync(new URL('../public/models/policy-depth6.policy', import.meta.url)),
);

test('the committed browser policy model loads and scores', () => {
  const policy = loadPolicy(model);
  assert.equal(policy.features, POLICY_FEATURES);
  assert.ok(policy.hidden >= 1 && policy.hidden <= 512);
  assert.equal(policy.byteLength, model.length);
  for (const value of [0, 0.25, 0.5, 1]) {
    assert.ok(Number.isFinite(policy.score(new Array(POLICY_FEATURES).fill(value))));
  }
  assert.equal(POLICY_MODEL_URL, '/models/policy-depth6.policy');
  assert.equal(POLICY_SCALE, 1000);
  assert.equal(POLICY_PLIES, 1);
});

test('policy loader returns bytes on success and null on failure', async () => {
  const ok = createPolicyLoader({
    url: '/model',
    fetchBytes: async () => ({ ok: true, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer }),
  });
  assert.deepEqual(Array.from(await ok()), [1, 2, 3]);
  assert.deepEqual(Array.from(await ok()), [1, 2, 3]);
  const notFound = createPolicyLoader({
    url: '/model',
    fetchBytes: async () => ({ ok: false, status: 404 }),
    reportError: () => {},
  });
  assert.equal(await notFound(), null);
  const threw = createPolicyLoader({
    url: '/model',
    fetchBytes: async () => {
      throw new Error('offline');
    },
    reportError: () => {},
  });
  assert.equal(await threw(), null);
});

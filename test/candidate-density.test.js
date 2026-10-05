import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { generateCandidateMoves } from '../src/ai/moves.js';

// Fingerprints captured from the original pairwise-density implementation.
const fixtures = JSON.parse(
  readFileSync(
    new URL('./fixtures/candidate-density-baseline.json', import.meta.url),
  ),
);
for (const fixture of fixtures) {
  for (const color of ['black', 'white']) {
    test(
      'candidate density preserves scores and ordering: ' +
        fixture.name +
        '/' +
        color,
      () => {
        const black = [...fixture.blackBitboard];
        const white = [...fixture.whiteBitboard];
        const candidates = generateCandidateMoves(black, white, color);
        const fingerprint = createHash('sha256')
          .update(JSON.stringify(candidates))
          .digest('hex');
        assert.equal(fingerprint, fixture.expected[color]);
        assert.deepEqual(black, fixture.blackBitboard);
        assert.deepEqual(white, fixture.whiteBitboard);
      },
    );
  }
}

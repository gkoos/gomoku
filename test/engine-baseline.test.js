import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { generateCandidateMoves } from '../src/ai/moves.js';
import { evaluatePosition } from '../src/ai/evaluation.js';
import { minimaxAlphaBeta } from '../src/ai/search.js';
import { findBestMove } from '../src/ai/engine.js';
const fixtureUrl = new URL('./fixtures/engine-baseline.json', import.meta.url);
const cases = JSON.parse(readFileSync(fixtureUrl));

async function metricsFor(fixture) {
  const { blackBitboard: black, whiteBitboard: white } = fixture;
  const metrics = {};
  for (const color of ['black', 'white']) {
    const opponent = color === 'black' ? 'white' : 'black';
    metrics[color] = {
      candidates: generateCandidateMoves(black, white, color),
      evaluation: evaluatePosition(black, white, color, opponent),
      search: minimaxAlphaBeta(
        black,
        white,
        2,
        -Infinity,
        Infinity,
        true,
        color,
        opponent,
        [],
        { protectForcingMoves: false, usePvs: false, reportProgress() {} },
        null,
        null,
        0, // Historical fixed-horizon baseline.
      ),
      choice: await findBestMove(
        black,
        white,
        color,
        opponent,
        'easy',
        () => {},
      ),
    };
  }
  return createHash('sha256').update(JSON.stringify(metrics)).digest('hex');
}

// Regenerate the recorded hashes after an intended engine change:
//   UPDATE_BASELINES=1 node --test test/engine-baseline.test.js
if (process.env.UPDATE_BASELINES === '1') {
  for (const fixture of cases) {
    fixture.expected = await metricsFor(fixture);
  }
  writeFileSync(fixtureUrl, JSON.stringify(cases, null, 2) + '\n');
  console.log(`Updated ${cases.length} engine baselines`);
} else {
  for (const fixture of cases)
    test('engine preserves baseline: ' + fixture.name, async () => {
      assert.equal(await metricsFor(fixture), fixture.expected);
    });
}


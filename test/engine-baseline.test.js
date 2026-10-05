import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { generateCandidateMoves } from '../src/ai/moves.js';
import { evaluatePosition } from '../src/ai/evaluation.js';
import { minimaxAlphaBeta } from '../src/ai/search.js';
import { findBestMove } from '../src/ai/engine.js';
const cases = JSON.parse(
  readFileSync(new URL('./fixtures/engine-baseline.json', import.meta.url)),
);
for (const fixture of cases)
  test('engine preserves baseline: ' + fixture.name, async () => {
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
    assert.equal(
      createHash('sha256').update(JSON.stringify(metrics)).digest('hex'),
      fixture.expected,
    );
  });

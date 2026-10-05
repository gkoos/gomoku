import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { findBestMove } from '../src/ai/engine.js';
import { evaluateMoveEnhanced } from '../src/ai/evaluation.js';
import { generateCandidateMoves } from '../src/ai/moves.js';
const wasm = createRequire(import.meta.url)(
  '../engine-rust/pkg/nodejs/gomoku_engine.js',
);
const bits = (ps) => {
  const b = new Uint32Array(8);
  for (const p of ps) b[p >>> 5] |= 1 << (p & 31);
  return b;
};
const fixtures = JSON.parse(
  readFileSync(
    new URL('../test/fixtures/engine-baseline.json', import.meta.url),
  ),
);
const cases = [
  ...fixtures.map((f) => [f.blackBitboard, f.whiteBitboard]),
  [bits([]), bits([])],
  [bits([0, 1, 2, 3, 4]), bits([])],
  [bits([31]), bits([31])],
  [bits([110, 111, 112, 68, 83, 98]), bits([109, 53, 155, 156, 157, 0])],
  [bits([108, 109, 110]), bits([0])],
  [bits([112]), bits([108, 109, 110])],
  [bits([0, 1, 2, 3]), bits([112])],
  [bits([112]), bits([0, 1, 2, 3])],
];
let seed = 0x7253ac41;
const random = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed >>> 0;
};
for (let i = 0; i < 300; i++) {
  const ps = Array.from({ length: 225 }, (_, p) => p);
  for (let n = 224; n > 0; n--) {
    const j = random() % (n + 1);
    [ps[n], ps[j]] = [ps[j], ps[n]];
  }
  const b = bits([]),
    w = bits([]);
  const count = [1, 8, 16, 24, 40, 64, 100, 160, 224][i % 9];
  for (const p of ps.slice(0, count))
    (random() & 1 ? b : w)[p >>> 5] |= 1 << (p & 31);
  cases.push([b, w]);
}
// Three-stone open-four shapes in every direction, including edges and crossings.
for (const [dr, dc] of [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
])
  for (let r = 0; r < 15; r++)
    for (let c = 0; c < 15; c++) {
      const line = Array.from({ length: 6 }, (_, i) => [
        r + i * dr,
        c + i * dc,
      ]);
      if (line.some(([r, c]) => r < 0 || r >= 15 || c < 0 || c >= 15)) continue;
      for (let gap = 1; gap <= 4; gap++)
        cases.push([
          bits(
            line
              .slice(1, 5)
              .filter((_, i) => i + 1 !== gap)
              .map(([r, c]) => r * 15 + c),
          ),
          bits([224].filter((p) => !line.some(([r, c]) => r * 15 + c === p))),
        ]);
    }
let roots = 0,
  scores = 0,
  defenses = 0;
for (const [bb, ww] of cases) {
  const b = Uint32Array.from(bb),
    w = Uint32Array.from(ww),
    before = [...b, ...w];
  for (const color of ['black', 'white']) {
    for (const easy of [false, true]) {
      const actual = wasm.select_root(b, w, color === 'black', easy);
      const expected = await findBestMove(
        b,
        w,
        color,
        color === 'black' ? 'white' : 'black',
        easy ? 'easy' : 'expert',
        () => {},
        { deepSearch: () => ({ row: -1, col: 13 }) },
      );
      assert.equal(
        actual,
        expected ? expected.row * 15 + expected.col : -1,
        JSON.stringify({ b: [...b], w: [...w], color, easy }),
      );
      roots++;
    }
    if (scores < 20000)
      for (const move of generateCandidateMoves(b, w, color)) {
        const actual = wasm.score_root_move(
          b,
          w,
          move.position,
          color === 'black',
          move.priority,
        );
        const expected = evaluateMoveEnhanced(
          b,
          w,
          move,
          color,
          color === 'black' ? 'white' : 'black',
        );
        assert.equal(actual, expected, JSON.stringify({ move, color }));
        scores++;
      }
  }
  assert.deepEqual([...b, ...w], before);
}
assert.throws(() => new wasm.MoveEngine(bits([]), bits([]), true, 4, 4, 32768));
assert.throws(() => wasm.score_root_move(bits([31]), bits([]), 31, true, 0));
console.log(
  `Root parity passed: ${roots} selections and ${scores} exact heuristic scores.`,
);

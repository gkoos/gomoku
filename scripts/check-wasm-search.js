import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { findBestMoveDeepSearch, minimaxAlphaBeta } from '../src/ai/search.js';
import { createPositionHasher } from '../src/ai/zobrist.js';
import { createTranspositionTable } from '../src/ai/transposition-table.js';
import { createSearchContext } from '../src/ai/search-context.js';
import { getBitboardResult } from '../src/core/rules.js';
const wasm = createRequire(import.meta.url)(
  '../engine-rust/pkg/nodejs/gomoku_engine.js',
);
const opposite = (c) => (c === 'black' ? 'white' : 'black');
const words = (b) => Uint32Array.from(b);
const decode = (a) => ({
  depth: a[0],
  score: a[1],
  nodes: a[2],
  cacheHits: a[3],
  cacheCutoffs: a[4],
  tableSize: a[5],
  principalVariation: Array.from(a.slice(7)),
});
const normalize = (r) => ({
  ...r,
  move: undefined,
  principalVariation: r.principalVariation?.map((m) => m.position) || [],
});
const bits = (ps) => {
  const b = new Uint32Array(8);
  for (const p of ps) b[p >>> 5] |= 1 << (p & 31);
  return b;
};
let iterations = 0,
  fixed = 0;
for (const start of ['black', 'white']) {
  const b = bits([]),
    w = bits([]),
    js = createPositionHasher(b, w, start),
    h = new wasm.PositionHasher(b, w, start === 'black');
  const check = () => {
    const [low, high] = h.words();
    assert.equal(`${high}:${low}`, js.key);
    assert.equal(h.black_to_move(), js.toMove === 'black');
  };
  try {
    let color = start;
    const moves = [];
    check();
    for (const p of [
      0, 14, 31, 32, 63, 64, 95, 96, 127, 128, 159, 160, 191, 192, 210, 224,
    ]) {
      h.toggle_move(p, color === 'black');
      js.toggleMove(p, color);
      moves.push([p, color]);
      color = opposite(color);
      check();
    }
    for (const [p, c] of moves.reverse()) {
      h.toggle_move(p, c === 'black');
      js.toggleMove(p, c);
      check();
    }
    const original = [...h.words()];
    assert.throws(() => h.toggle_move(225, true));
    assert.deepEqual([...h.words()], original);
  } finally {
    h.free();
  }
}
const fixtures = JSON.parse(
  readFileSync(
    new URL('../test/fixtures/engine-baseline.json', import.meta.url),
  ),
);
const tactical = [
  {
    name: 'fork',
    blackBitboard: bits([110, 111, 112, 68, 83, 98]),
    whiteBitboard: bits([109, 53, 155, 156, 157, 0]),
  },
  {
    name: 'immediate-win',
    blackBitboard: bits([108, 109, 110, 111]),
    whiteBitboard: bits([0]),
  },
  {
    name: 'mandatory-block',
    blackBitboard: bits([107]),
    whiteBitboard: bits([108, 109, 110, 111]),
  },
  {
    name: 'double-threat',
    blackBitboard: bits([0]),
    whiteBitboard: bits([108, 109, 110, 111]),
  },
  {
    name: 'forcing-chain',
    blackBitboard: bits([109, 69, 84, 99, 125, 85, 100, 115, 141]),
    whiteBitboard: bits([
      110, 111, 112, 113, 54, 126, 127, 128, 70, 142, 143, 144,
    ]),
  },
];
for (const fixture of [...fixtures, ...tactical])
  for (const color of ['black', 'white'])
    for (const capacity of [0, 32768]) {
      const b = words(fixture.blackBitboard),
        w = words(fixture.whiteBitboard),
        depth = fixture.name === 'seeded-0' ? 3 : 4;
      const expected = [];
      findBestMoveDeepSearch(b, w, color, opposite(color), () => {}, depth, {
        useTranspositionTable: capacity !== 0,
        onIteration: (r) => expected.push(normalize(r)),
      });
      const search = new wasm.SearchEngine(
          b,
          w,
          color === 'black',
          depth,
          4,
          capacity,
        ),
        actual = [];
      try {
        const initial = [...search.hash_words()];
        for (;;) {
          const packed = search.next_depth();
          if (!packed.length) break;
          actual.push(decode(packed));
          assert.deepEqual([...search.hash_words()], initial);
          assert.deepEqual(search.occupancy(true), b);
          assert.deepEqual(search.occupancy(false), w);
          assert.equal(search.history_length(), 0);
        }
        assert.deepEqual(
          actual,
          expected.map(({ move, ...r }) => r),
          `${fixture.name}/${color}/cache=${capacity}`,
        );
        iterations += actual.length;
        assert.equal(search.next_depth().length, 0);
      } finally {
        search.free();
      }
    }
// Tiny table verifies FIFO eviction and repeated bounds; extension budgets include zero.
for (const fixture of tactical)
  for (const color of ['black', 'white'])
    for (const maximizing of [true, false])
      for (const extension of [0, 1, 4, 6]) {
        const b = words(fixture.blackBitboard),
          w = words(fixture.whiteBitboard),
          search = new wasm.SearchEngine(
            b,
            w,
            color === 'black',
            3,
            extension,
            2,
          );
        const context = createSearchContext(
          b,
          w,
          maximizing ? color : opposite(color),
          { table: createTranspositionTable({ maxEntries: 2 }) },
        );
        try {
          for (const [depth, alpha, beta] of [
            [0, -2000000, 2000000],
            [1, -2000000, 2000000],
            [3, -100, 100],
            [3, -2000000, 2000000],
            [3, -2000000, 2000000],
          ]) {
            const tracker = { nodes: 0, trackPV: true, reportProgress() {} };
            const h = context.stats.hits,
              c = context.stats.cutoffs;
            const r = minimaxAlphaBeta(
              b,
              w,
              depth,
              alpha,
              beta,
              maximizing,
              color,
              opposite(color),
              [],
              tracker,
              null,
              context,
              extension,
            );
            const expected = {
              depth,
              score: r.score,
              nodes: tracker.nodes,
              cacheHits: context.stats.hits - h,
              cacheCutoffs: context.stats.cutoffs - c,
              tableSize: context.table.size,
              principalVariation:
                r.principalVariation?.map((m) => m.position) || [],
            };
            assert.deepEqual(
              decode(search.fixed_depth(depth, maximizing, alpha, beta)),
              expected,
              `${fixture.name}/${color}/max=${maximizing}/q=${extension}/d=${depth}`,
            );
            assert.equal(search.history_length(), 0);
            fixed++;
          }
        } finally {
          search.free();
        }
      }
// Terminal and malformed boards produce no iterative move, as in JavaScript.
const drawB = bits([]),
  drawW = bits([]);
for (let p = 0; p < 225; p++)
  ((Math.floor(p / 15) + Math.floor((p % 15) / 2)) % 2 ? drawB : drawW)[
    p >>> 5
  ] |= 1 << (p & 31);
assert.deepEqual(getBitboardResult(drawB, drawW), { draw: true });
for (const [b, w] of [
  [bits([0, 1, 2, 3, 4]), bits([])],
  [bits([0]), bits([0])],
  [drawB, drawW],
  [bits([0, 1, 2, 3, 4]), bits([15, 16, 17, 18, 19])],
]) {
  const s = new wasm.SearchEngine(b, w, true, 10, 4, 32768);
  try {
    assert.equal(s.next_depth().length, 0);
  } finally {
    s.free();
  }
}

// A nearly-full draw keeps ten complete depths cheap while checking the cap.
const nearB = drawB.slice(),
  nearW = drawW.slice();
nearB[7] &= ~1;
nearW[7] &= ~1;
for (const color of ['black', 'white']) {
  const expected = [];
  findBestMoveDeepSearch(nearB, nearW, color, opposite(color), () => {}, 10, {
    onIteration: (r) => expected.push(normalize(r)),
  });
  const search = new wasm.SearchEngine(
      nearB,
      nearW,
      color === 'black',
      10,
      4,
      32768,
    ),
    actual = [];
  try {
    for (;;) {
      const result = search.next_depth();
      if (!result.length) break;
      actual.push(decode(result));
    }
    assert.deepEqual(
      actual,
      expected.map(({ move, ...r }) => r),
    );
    assert.equal(actual.length, 10);
    iterations += actual.length;
  } finally {
    search.free();
  }
}
assert.throws(() => new wasm.SearchEngine(bits([]), bits([]), true, 226, 4, 0));
assert.throws(() => new wasm.SearchEngine(bits([]), bits([]), true, 8, 226, 0));
const zero = new wasm.SearchEngine(bits([]), bits([]), true, 0, 4, 0);
try {
  assert.throws(() => zero.fixed_depth(1, true, -2000000, 2000000));
} finally {
  zero.free();
}
console.log(
  `Search Rust/Wasm parity passed: ${iterations} completed iterations and ${fixed} fixed searches; moves/PVs, scores, nodes, cache hits/cutoffs/size, forced horizons, bounds, FIFO, hashes and root restoration.`,
);

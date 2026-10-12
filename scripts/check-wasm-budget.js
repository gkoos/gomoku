import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { findBestMoveDeepSearch } from '../src/ai/search.js';
const wasm = createRequire(import.meta.url)(
  '../engine-rust/pkg/nodejs/gomoku_engine.js',
);
const opposite = (c) => (c === 'black' ? 'white' : 'black');
const bits = (ps) => {
  const b = new Uint32Array(8);
  for (const p of ps) b[p >>> 5] |= 1 << (p & 31);
  return b;
};
/** Both sides reduce a completed iteration to the fields the budget can affect. */
const decode = (a) => ({
  depth: a[0],
  score: a[1],
  nodes: a[2],
  pv: Array.from(a.slice(7, 7 + a[6])),
});
const reference = (b, w, color, depth) => {
  const iterations = [];
  findBestMoveDeepSearch(b, w, color, opposite(color), () => {}, depth, {
    onIteration: ({ depth: completed, score, nodes, principalVariation }) =>
      iterations.push({
        depth: completed,
        score,
        nodes,
        pv: (principalVariation || []).map((m) => m.position),
      }),
  });
  return iterations;
};
const bounded = (b, w, computerBlack, depth, budget, playCuts = false) => {
  const search = new wasm.SearchEngine(b, w, computerBlack, depth, 4, 32768);
  const iterations = [];
  try {
    if (budget !== undefined) {
      search.set_node_budget(budget);
      // Cut publication is off by default; the A/B behind that choice is in
      // docs/timeline.md (Phase 20).
      if (playCuts) search.set_cut_playback(true);
    }
    for (;;) {
      const result = search.next_depth();
      if (!result.length) break;
      iterations.push(decode(result));
    }
    return {
      iterations,
      nodes: search.total_nodes(),
      exhausted: search.budget_exhausted(),
    };
  } finally {
    search.free();
  }
};

// A budget of zero and a budget beyond the total cost must both be neutral, so
// the unbounded engine keeps the reference behavior exactly.
const fixtures = JSON.parse(
  readFileSync(new URL('../test/fixtures/engine-baseline.json', import.meta.url)),
);
let neutral = 0;
for (const fixture of fixtures)
  for (const color of ['black', 'white']) {
    const b = Uint32Array.from(fixture.blackBitboard),
      w = Uint32Array.from(fixture.whiteBitboard),
      depth = fixture.name === 'seeded-0' ? 3 : 4;
    const expected = reference(b, w, color, depth);
    for (const budget of [0, 1_000_000_000]) {
      const run = bounded(b, w, color === 'black', depth, budget);
      assert.deepEqual(run.iterations, expected, `${fixture.name}/${color}`);
      assert.equal(run.exhausted, false, `${fixture.name}/${color}`);
      // The completed iterations add up to the reported whole-move total.
      assert.equal(
        run.nodes,
        run.iterations.reduce((sum, iteration) => sum + iteration.nodes, 0),
        `${fixture.name}/${color}`,
      );
      neutral++;
    }
  }

// Budgets that land mid-iteration: the completed prefix is untouched, the cut is
// discarded by default, and the total never overshoots the requested nodes.
const board = [bits([112, 128, 99]), bits([113, 97, 127])];
const depth = 6;
const full = reference(board[0], board[1], 'black', depth);
assert.equal(full.length, depth);
const budget = full[0].nodes + full[1].nodes + Math.floor(full[2].nodes / 2);
const run = bounded(board[0], board[1], true, depth, budget);
assert.deepEqual(run.iterations, full.slice(0, 2));
assert.equal(run.exhausted, true);
assert.equal(run.nodes, budget);
assert.deepEqual(bounded(board[0], board[1], true, depth, 1), {
  iterations: full.slice(0, 1),
  nodes: full[0].nodes,
  exhausted: true,
});
// A repeated budget is reproducible: it is a node count, not a clock.
assert.deepEqual(bounded(board[0], board[1], true, depth, budget), run);

// The diagnostic publishes a cut iteration when a completed root move improved on
// the line before it. This also counts how often that changes the move at all.
let cuts = 0;
let changed = 0;
for (let level = 2; level < full.length; level++) {
  const head = full.slice(0, level).reduce((sum, iteration) => sum + iteration.nodes, 0);
  const target = head + Math.floor(full[level].nodes / 2);
  const enabled = bounded(board[0], board[1], true, depth, target, true);
  assert.deepEqual(enabled.iterations.slice(0, level), full.slice(0, level), `level=${level}`);
  assert.ok(enabled.iterations.length <= level + 1, `level=${level}`);
  assert.equal(enabled.nodes, target, `level=${level}`);
  assert.equal(enabled.exhausted, true, `level=${level}`);
  const cut = enabled.iterations[level];
  if (!cut) continue;
  cuts++;
  assert.equal(cut.depth, level + 1, `level=${level}`);
  assert.ok(cut.nodes > 0 && cut.score > full[level - 1].score, `level=${level}`);
  if (cut.pv[0] !== full[level - 1].pv[0]) changed++;
}
assert.ok(cuts > 0, 'enabling cut playback must publish a cut');
console.log(
  `Node budget cuts: ${changed}/${cuts} published cuts changed the move; the rest repeated the previous line.`,
);

// Invalid or late budgets are rejected rather than silently ignored.
const search = new wasm.SearchEngine(board[0], board[1], true, depth, 4, 32768);
try {
  for (const invalid of [NaN, -1, 1_000_000_001])
    assert.throws(() => search.set_node_budget(invalid));
  search.next_depth();
  assert.throws(() => search.set_node_budget(4096));
} finally {
  search.free();
}
console.log(
  `Node budget passed: ${neutral} neutral budgets, ${cuts} published cuts at exact totals, a discarded cut by default, and the exempt first iteration; depth/nodes ${full.map((i) => `${i.depth}:${i.nodes}`).join(',')}, cut at ${budget} nodes.`,
);

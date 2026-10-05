import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createPositionHasher } from '../src/ai/zobrist.js';
import {
  createSearchContext,
  transpositionKey,
} from '../src/ai/search-context.js';
import {
  createTranspositionTable,
  EXACT,
  LOWER_BOUND,
  UPPER_BOUND,
  scoreToTable,
  scoreFromTable,
} from '../src/ai/transposition-table.js';
import { createIncrementalEvaluator } from '../src/ai/incremental-evaluation.js';
import { minimaxAlphaBeta, findBestMoveDeepSearch } from '../src/ai/search.js';
import { generateCandidateMoves } from '../src/ai/moves.js';
import { WIN_SCORE } from '../src/ai/config.js';

const opposite = (c) => (c === 'black' ? 'white' : 'black');
function bits(stones = []) {
  const b = Array(8).fill(0);
  for (const p of stones) b[p >>> 5] |= 1 << (p % 32);
  return b;
}
function tracker(pv = []) {
  return {
    nodes: 0,
    trackPV: true,
    principalVariation: pv,
    reportProgress() {},
  };
}
function run(
  b,
  w,
  depth,
  computer = 'black',
  max = true,
  track = tracker(),
  context = null,
  alpha = -Infinity,
  beta = Infinity,
  history = [],
) {
  return minimaxAlphaBeta(
    b,
    w,
    depth,
    alpha,
    beta,
    max,
    computer,
    opposite(computer),
    history,
    track,
    null,
    context,
  );
}
test('incremental Zobrist keys match complete recomputation and undo at bitboard boundaries', () => {
  for (const startingColor of ['black', 'white']) {
    const b = bits(),
      w = bits(),
      hasher = createPositionHasher(b, w, startingColor),
      initial = hasher.key,
      moves = [];
    let color = startingColor;
    for (const p of [
      0, 14, 31, 32, 63, 64, 95, 96, 127, 128, 159, 160, 191, 192, 210, 224,
    ]) {
      hasher.toggleMove(p, color);
      (color === 'black' ? b : w)[p >>> 5] |= 1 << (p % 32);
      moves.push([p, color]);
      color = opposite(color);
      assert.equal(hasher.toMove, color);
      assert.equal(hasher.key, createPositionHasher(b, w, color).key);
    }
    for (const [p, c] of moves.reverse()) {
      hasher.toggleMove(p, c);
      (c === 'black' ? b : w)[p >>> 5] &= ~(1 << (p % 32));
      assert.equal(hasher.key, createPositionHasher(b, w, c).key);
    }
    assert.equal(hasher.key, initial);
    assert.equal(hasher.toMove, startingColor);
  }
});
test('hashes distinguish colors and turns but not move order', () => {
  const empty = bits();
  assert.notEqual(
    createPositionHasher(empty, empty, 'black').key,
    createPositionHasher(empty, empty, 'white').key,
  );
  assert.notEqual(
    createPositionHasher(bits([31]), empty, 'black').key,
    createPositionHasher(empty, bits([31]), 'black').key,
  );
  const first = createPositionHasher(empty, empty, 'black'),
    second = createPositionHasher(empty, empty, 'black');
  for (const [p, c] of [
    [31, 'black'],
    [32, 'white'],
    [224, 'black'],
    [210, 'white'],
  ])
    first.toggleMove(p, c);
  for (const [p, c] of [
    [224, 'black'],
    [210, 'white'],
    [31, 'black'],
    [32, 'white'],
  ])
    second.toggleMove(p, c);
  assert.equal(first.key, second.key);
  assert.equal(first.toMove, second.toMove);
  const key = first.key;
  assert.throws(() => first.toggleMove(225, 'black'), /outside/);
  assert.throws(() => first.toggleMove(2, 'purple'), /Invalid/);
  assert.equal(first.key, key);
});
test('transposition hits verify complete boards and turn, including deliberate hash collisions', () => {
  const table = createTranspositionTable(),
    b = bits([31]),
    w = bits([224]);
  table.store('same-hash', b, w, 'black', {
    score: 30,
    flag: EXACT,
    depth: 2,
    move: { row: 0, col: 0 },
    principalVariation: [{ row: 0, col: 0 }],
  });
  assert.equal(table.get('same-hash', [...b], [...w], 'black').score, 30);
  assert.equal(table.get('same-hash', bits([32]), w, 'black'), null);
  assert.equal(table.get('same-hash', b, w, 'white'), null);
  assert.equal(table.get('same-hash', w, b, 'black'), null);
  assert.equal(
    table.get('same-hash', new Int32Array(b), new Int32Array(w), 'black').score,
    30,
  );
  b[0] = 0;
  assert.equal(table.get('same-hash', bits([31]), w, 'black').score, 30);
});
test('table capacity is bounded and stronger bounds replace weaker ones', () => {
  const table = createTranspositionTable({ maxEntries: 2 }),
    b = bits(),
    w = bits();
  const store = (key, score, flag) =>
    table.store(key, b, w, 'black', { score, flag, depth: 2, move: null });
  store('a', 10, LOWER_BOUND);
  store('a', 5, LOWER_BOUND);
  assert.equal(table.get('a', b, w, 'black').score, 10);
  store('a', 15, LOWER_BOUND);
  assert.equal(table.get('a', b, w, 'black').score, 15);
  store('b', -10, UPPER_BOUND);
  store('b', -5, UPPER_BOUND);
  assert.equal(table.get('b', b, w, 'black').score, -10);
  store('b', -15, UPPER_BOUND);
  assert.equal(table.get('b', b, w, 'black').score, -15);
  store('a', 20, EXACT);
  store('a', 40, LOWER_BOUND);
  assert.equal(table.get('a', b, w, 'black').flag, EXACT);
  assert.equal(table.get('a', b, w, 'black').score, 20);
  store('c', 0, EXACT);
  assert.equal(table.size, 2);
  assert.equal(table.get('a', b, w, 'black'), null);
  table.clear();
  assert.equal(table.size, 0);
  assert.throws(() => createTranspositionTable({ maxEntries: 0 }), /capacity/);
});
test('mate scores normalize distance from the cached position, not the old root', () => {
  assert.equal(
    scoreFromTable(scoreToTable(WIN_SCORE - 7, 3), 6),
    WIN_SCORE - 10,
  );
  assert.equal(
    scoreFromTable(scoreToTable(-WIN_SCORE + 7, 3), 6),
    -WIN_SCORE + 10,
  );
  for (const value of [0, 20, -20, 500000, -500000])
    assert.equal(scoreFromTable(scoreToTable(value, 3), 6), value);
});
test('cache identity includes horizon, perspective, PV tracking and remaining selective-search PV', () => {
  const context = createSearchContext(bits(), bits(), 'black');
  const plain = transpositionKey(context, 4, 'black', [], tracker());
  assert.notEqual(plain, transpositionKey(context, 3, 'black', [], tracker()));
  assert.notEqual(plain, transpositionKey(context, 4, 'white', [], tracker()));
  assert.notEqual(plain, transpositionKey(context, 4, 'black', [], null));
  const pv = [{ position: 1 }, { position: 2 }, { position: 3 }];
  assert.notEqual(
    plain,
    transpositionKey(context, 4, 'black', [], tracker(pv)),
  );
  assert.equal(
    plain,
    transpositionKey(context, 4, 'black', [{ position: 99 }], tracker(pv)),
  );
  assert.notEqual(
    plain,
    transpositionKey(context, 4, 'black', [{ position: 1 }], tracker(pv)),
  );
});
test('exact cache hits skip the subtree and return independent result objects', () => {
  const b = bits([112]),
    w = bits([113]),
    context = createSearchContext(b, w, 'black'),
    firstTrack = tracker();
  const first = run(b, w, 3, 'black', true, firstTrack, context),
    secondTrack = tracker();
  const second = run(b, w, 3, 'black', true, secondTrack, context);
  assert.deepEqual(second, first);
  assert.ok(firstTrack.nodes > 1);
  assert.equal(secondTrack.nodes, 1);
  second.move.row = 99;
  second.principalVariation[0].col = 99;
  assert.deepEqual(run(b, w, 3, 'black', true, tracker(), context), first);
});
test('bound entries cut off matching windows but are not treated as exact in a wider search', () => {
  const b = bits([112]),
    w = bits([113]),
    exact = run(b, w, 3);
  for (const flag of [LOWER_BOUND, UPPER_BOUND]) {
    const context = createSearchContext(b, w, 'black');
    const alpha = flag === UPPER_BOUND ? exact.score + 1 : -Infinity,
      beta = flag === LOWER_BOUND ? exact.score - 1 : Infinity;
    const narrow = run(b, w, 3, 'black', true, tracker(), context, alpha, beta);
    const key = transpositionKey(context, 3, 'black', [], tracker());
    assert.equal(context.table.get(key, b, w, 'black').flag, flag);
    const repeated = tracker();
    assert.deepEqual(
      run(b, w, 3, 'black', true, repeated, context, alpha, beta),
      narrow,
    );
    assert.equal(repeated.nodes, 1);
    const widened = tracker();
    assert.deepEqual(run(b, w, 3, 'black', true, widened, context), exact);
    assert.ok(widened.nodes > 1);
    assert.equal(context.table.get(key, b, w, 'black').flag, EXACT);
  }
});
test('cached wins and losses retain mate distance when the same board is reached at another ply', () => {
  const winning = bits([0, 1, 2, 3]),
    other = bits([180, 182]);
  for (const computer of ['black', 'white']) {
    const max = computer === 'black',
      context = createSearchContext(winning, other, 'black');
    const original = run(winning, other, 2, computer, max, tracker(), context);
    const track = tracker(),
      history = [
        { row: 12, col: 0, position: 180 },
        { row: 0, col: 1, position: 1 },
        { row: 12, col: 2, position: 182 },
      ];
    const reused = run(
      winning,
      other,
      2,
      computer,
      max,
      track,
      context,
      -Infinity,
      Infinity,
      history,
    );
    assert.equal(track.nodes, 1);
    assert.equal(reused.score, max ? original.score - 3 : original.score + 3);
    assert.equal(reused.move.position, original.move.position);
  }
});
test('shallow, opposite-perspective and different-PV searches cannot reuse incompatible root scores', () => {
  const b = bits([112]),
    w = bits([113]),
    table = createTranspositionTable();
  let context = createSearchContext(b, w, 'black', { table });
  run(b, w, 1, 'black', true, tracker(), context);
  const deeper = tracker();
  assert.deepEqual(run(b, w, 3, 'black', true, deeper, context), run(b, w, 3));
  assert.ok(deeper.nodes > 1);
  context = createSearchContext(b, w, 'black', { table });
  assert.deepEqual(
    run(b, w, 3, 'white', false, tracker(), context),
    run(b, w, 3, 'white', false),
  );
  const pv = [generateCandidateMoves(b, w, 'black').at(-1)];
  assert.deepEqual(
    run(b, w, 3, 'black', true, tracker(pv), context),
    run(b, w, 3, 'black', true, tracker(pv)),
  );
});
test('hash and evaluation state restore after interrupted search without storing an incomplete root', () => {
  const b = bits([112]),
    w = bits([113]),
    state = createIncrementalEvaluator(b, w, 'black'),
    context = createSearchContext(b, w, 'black');
  const key = context.hasher.key,
    score = state.getScore();
  let reports = 0;
  const interrupted = {
    ...tracker(),
    reportProgress() {
      if (++reports === 8) throw new Error('interrupted');
    },
  };
  assert.throws(
    () =>
      minimaxAlphaBeta(
        b,
        w,
        3,
        -Infinity,
        Infinity,
        true,
        'black',
        'white',
        [],
        interrupted,
        state,
        context,
      ),
    /interrupted/,
  );
  assert.equal(context.hasher.key, key);
  assert.equal(context.hasher.toMove, 'black');
  assert.equal(state.getScore(), score);
  assert.equal(
    context.table.get(
      transpositionKey(context, 3, 'black', [], tracker()),
      b,
      w,
      'black',
    ),
    null,
  );
  assert.deepEqual(
    run(b, w, 3, 'black', true, tracker(), context),
    run(b, w, 3),
  );
});
test('full position verification prevents a deliberately colliding hasher from changing search results', () => {
  const b = bits([112]),
    w = bits([113]),
    context = createSearchContext(b, w, 'black');
  context.hasher = { key: 'collision', toggleMove() {} };
  assert.deepEqual(
    run(b, w, 3, 'black', true, tracker(), context),
    run(b, w, 3),
  );
});
const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures/engine-baseline.json', import.meta.url)),
);
for (const fixture of fixtures.slice(0, 5))
  for (const perspective of ['black', 'white']) {
    test(
      'cached iterative deepening matches uncached depths: ' +
        fixture.name +
        '/' +
        perspective,
      () => {
        const cached = [],
          uncached = [];
        const search = (enabled, iterations) =>
          findBestMoveDeepSearch(
            fixture.blackBitboard,
            fixture.whiteBitboard,
            perspective,
            opposite(perspective),
            null,
            4,
            {
              useTranspositionTable: enabled,
              transpositionTable: enabled
                ? createTranspositionTable({ maxEntries: 256 })
                : undefined,
              onIteration: (r) => iterations.push(r),
            },
          );
        assert.deepEqual(search(true, cached), search(false, uncached));
        const results = (iterations) =>
          iterations.map(({ depth, score, move, principalVariation }) => ({
            depth,
            score,
            move,
            principalVariation,
          }));
        assert.deepEqual(results(cached), results(uncached));
        assert.ok(cached.every((r) => r.tableSize <= 256));
      },
    );
  }
test('real transpositions reduce visited nodes while preserving the completed answer', () => {
  const f = fixtures[1],
    cached = [],
    uncached = [];
  for (const [enabled, iterations] of [
    [false, uncached],
    [true, cached],
  ])
    findBestMoveDeepSearch(
      f.blackBitboard,
      f.whiteBitboard,
      'black',
      'white',
      null,
      4,
      {
        useTranspositionTable: enabled,
        onIteration: (r) => iterations.push(r),
      },
    );
  assert.equal(cached.at(-1).score, uncached.at(-1).score);
  assert.deepEqual(cached.at(-1).move, uncached.at(-1).move);
  assert.ok(cached.at(-1).cacheCutoffs > 0);
  assert.ok(cached.at(-1).nodes < uncached.at(-1).nodes);
});

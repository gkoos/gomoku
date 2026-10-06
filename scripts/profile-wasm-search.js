import assert from 'node:assert/strict';
import { Session } from 'node:inspector';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
const wasm = createRequire(import.meta.url)(
  '../engine-rust/pkg/nodejs/gomoku_engine.js',
);
const fixtures = JSON.parse(
  readFileSync(
    new URL('../test/fixtures/engine-baseline.json', import.meta.url),
  ),
);
const bits = (ps) => {
  const b = new Uint32Array(8);
  for (const p of ps) b[p >>> 5] |= 1 << (p & 31);
  return b;
};
const duration = Number(
  process.argv.find((a) => a.startsWith('--duration-ms='))?.split('=')[1] ??
    2000,
);
if (!Number.isFinite(duration) || duration < 250)
  throw Error('Duration must be at least 250 ms');
const output = resolve('.profiles/wasm-search');
mkdirSync(output, { recursive: true });
const cases = [
  ...[
    ['seeded-1', 7, 'one-stone opening'],
    ['seeded-2', 6, 'six-stone opening'],
    ['seeded-4', 6, '20-stone middlegame'],
    ['seeded-9', 6, '12-stone development'],
    ['seeded-5', 6, '32-stone tactical position'],
  ].map(([name, depth, description]) => ({
    ...fixtures.find((f) => f.name === name),
    depth,
    description,
  })),
  {
    name: 'forcing-chain',
    description: 'forced tactical replies (root bypassed)',
    depth: 6,
    blackBitboard: bits([109, 69, 84, 99, 125, 85, 100, 115, 141]),
    whiteBitboard: bits([
      110, 111, 112, 113, 54, 126, 127, 128, 70, 142, 143, 144,
    ]),
  },
];
function run(f, capacity) {
  const engine = new wasm.SearchEngine(
    f.blackBitboard,
    f.whiteBitboard,
    true,
    f.depth,
    4,
    capacity,
  );
  let last,
    nodes = 0,
    hits = 0,
    cutoffs = 0,
    iterations = 0;
  try {
    for (;;) {
      const r = engine.next_depth();
      if (!r.length) break;
      last = r;
      nodes += r[2];
      hits += r[3];
      cutoffs += r[4];
      iterations++;
    }
  } finally {
    engine.free();
  }
  return {
    depth: last?.[0] ?? 0,
    score: last?.[1] ?? 0,
    pv: last ? Array.from(last.slice(7)) : [],
    nodes,
    hits,
    cutoffs,
    iterations,
  };
}
const answer = (r) => ({ depth: r.depth, score: r.score, pv: r.pv });
const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
function category(stack) {
  const has = (re) => stack.some((frame) => re.test(frame.functionName));
  if (has(/moves::generate_(?:into|with_density)/))
    return 'candidate generation';
  if (has(/incremental::Evaluator.*(?:make_move|undo_move|place)/))
    return 'make/undo evaluation';
  if (has(/transposition::|hashbrown|hash::|sip::|Search.*::key/))
    return 'transposition cache';
  if (has(/rules::/)) return 'win/terminal checks';
  if (
    has(
      /incremental::Evaluator.*(?:new|with_lines)|lines::LineBoards.*::new|WinningCache.*::new/,
    )
  )
    return 'state initialization';
  if (has(/search::Search/)) return 'other search';
  if (
    has(/wasm:|gomoku_engine|__rust|__rdl|dlmalloc/) ||
    stack.some((f) => f.url?.startsWith('wasm:'))
  )
    return 'other Wasm/allocator';
  return 'JavaScript/runtime';
}
function summarize(profile) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const parents = new Map();
  for (const n of profile.nodes)
    for (const c of n.children ?? []) parents.set(c, n.id);
  const categories = {},
    details = {},
    functions = new Map();
  let total = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const node = nodes.get(profile.samples[i]);
    const weight = profile.timeDeltas[i] ?? 0;
    total += weight;
    const stack = [];
    let current = node;
    while (current) {
      stack.push(current.callFrame);
      current = nodes.get(parents.get(current.id));
    }
    const group = category(stack);
    categories[group] = (categories[group] ?? 0) + weight;
    const has = (re) => stack.some((frame) => re.test(frame.functionName));
    let detail = group;
    if (group === 'candidate generation')
      detail = has(/select_nth_unstable_by/)
        ? 'candidate partitioning'
        : has(/slice::sort::/)
          ? 'candidate sorting'
          : 'candidate generation excluding visible sorting';
    if (group === 'make/undo evaluation')
      detail = has(/patterns::classify/)
        ? 'pattern classification during make/undo'
        : has(/WinningCache.*::refresh|WinningColor.*::replace/)
          ? 'winning-cache updates during make/undo'
          : 'other make/undo';
    details[detail] = (details[detail] ?? 0) + weight;
    const key = node.callFrame.functionName || '(anonymous)';
    functions.set(key, (functions.get(key) ?? 0) + weight);
  }
  return {
    samples: profile.samples.length,
    sampledMs: total / 1000,
    categories: Object.fromEntries(
      Object.entries(categories)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => [k, Number(((v / total) * 100).toFixed(2))]),
    ),
    details: Object.fromEntries(
      Object.entries(details)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => [k, Number(((v / total) * 100).toFixed(2))]),
    ),
    topFunctions: [...functions]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([name, time]) => ({
        name,
        percent: Number(((time / total) * 100).toFixed(2)),
      })),
  };
}
const session = new Session();
session.connect();
const post = (method, params = {}) =>
  new Promise((resolve, reject) =>
    session.post(method, params, (error, result) =>
      error ? reject(error) : resolve(result),
    ),
  );
const report = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  durationMs: duration,
  samplingIntervalUs: 100,
  perspective: 'black',
  tacticalExtension: 4,
  cachedTableCapacity: 32768,
  wasmSha256: createHash('sha256')
    .update(
      readFileSync(
        new URL(
          '../engine-rust/pkg/nodejs/gomoku_engine_bg.wasm',
          import.meta.url,
        ),
      ),
    )
    .digest('hex'),
  method:
    'Uninstrumented release Wasm, Node V8 CPU sampling; complete iterative searches including construction/free. Two warmups, seven alternating cache-on/off timing runs. Sample categories use nearest relevant subsystem in stack; optimized inlining limits attribution. Root tactical shortcuts intentionally bypassed.',
  cases: [],
};
try {
  await post('Profiler.enable');
  await post('Profiler.setSamplingInterval', { interval: 100 });
  for (const original of cases) {
    const f = {
      ...original,
      blackBitboard: Uint32Array.from(original.blackBitboard),
      whiteBitboard: Uint32Array.from(original.whiteBitboard),
    };
    const expected = run(f, 32768);
    const uncached = run(f, 0);
    assert.deepEqual(answer(expected), answer(uncached));
    for (let i = 0; i < 2; i++) {
      run(f, 32768);
      run(f, 0);
    }
    const times = { cached: [], uncached: [] };
    for (let i = 0; i < 7; i++)
      for (const [key, capacity] of i % 2
        ? [
            ['uncached', 0],
            ['cached', 32768],
          ]
        : [
            ['cached', 32768],
            ['uncached', 0],
          ]) {
        const start = performance.now();
        const result = run(f, capacity);
        times[key].push(performance.now() - start);
        assert.deepEqual(result, capacity ? expected : uncached);
      }
    await post('Profiler.start');
    const start = performance.now();
    let runs = 0,
      last;
    while (performance.now() - start < duration) {
      last = run(f, 32768);
      runs++;
    }
    const elapsed = performance.now() - start;
    const { profile } = await post('Profiler.stop');
    assert.deepEqual(last, expected);
    writeFileSync(
      resolve(output, f.name + '.cpuprofile'),
      JSON.stringify(profile),
    );
    const result = {
      name: f.name,
      description: f.description,
      cap: f.depth,
      blackBitboard: [...f.blackBitboard],
      whiteBitboard: [...f.whiteBitboard],
      cached: expected,
      uncached,
      cachedMedianMs: median(times.cached),
      uncachedMedianMs: median(times.uncached),
      profiledRuns: runs,
      profiledElapsedMs: elapsed,
      ...summarize(profile),
    };
    report.cases.push(result);
    console.log(
      JSON.stringify({
        name: result.name,
        depth: expected.depth,
        nodes: expected.nodes,
        cachedMs: +result.cachedMedianMs.toFixed(3),
        uncachedMs: +result.uncachedMedianMs.toFixed(3),
        hits: expected.hits,
        cutoffs: expected.cutoffs,
        samples: result.samples,
        categories: result.categories,
      }),
    );
  }
} finally {
  session.disconnect();
}
writeFileSync(
  resolve(output, 'summary.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  'Saved .profiles/wasm-search/summary.json and Chrome DevTools .cpuprofile files.',
);

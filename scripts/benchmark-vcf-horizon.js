import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { initSync, SearchEngine } from '../src/ai/wasm/gomoku_engine.js';

const options = {};
for (const arg of process.argv.slice(2)) {
  const match = /^--(wasm|output|pvs|forcing)=(.+)$/.exec(arg);
  if (!match) throw new Error(`Unknown argument: ${arg}`);
  options[match[1]] = match[2];
}
if (options.pvs && !['on', 'off'].includes(options.pvs)) throw new Error('PVS must be on or off');
if (options.forcing && !['on', 'off'].includes(options.forcing)) throw new Error('Forcing must be on or off');
const file = options.wasm || 'src/ai/wasm/gomoku_engine_bg.wasm';
const bytes = readFileSync(file);
initSync({ module: bytes });
const fixtures = JSON.parse(readFileSync('test/fixtures/engine-baseline.json'));
const results = [];
for (const [name, depth] of [['seeded-1', 6], ['seeded-4', 5], ['seeded-8', 4]]) {
  const fixture = fixtures.find(f => f.name === name);
  const run = () => {
    const engine = new SearchEngine(Uint32Array.from(fixture.blackBitboard),
      Uint32Array.from(fixture.whiteBitboard), true, depth, 4, 32768);
    if (options.pvs) engine.set_pvs(options.pvs === 'on');
    if (options.forcing) engine.set_forcing_moves(options.forcing === 'on');
    let last;
    try {
      for (;;) {
        const result = engine.next_depth();
        if (!result.length) break;
        last = Array.from(result);
      }
    } finally { engine.free(); }
    return last;
  };
  run(); run();
  const times = [];
  let result;
  for (let sample = 0; sample < 7; sample++) {
    const start = performance.now();
    result = run();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  results.push({ name, depth, medianMilliseconds: times[3],
    completedDepth: result[0], score: result[1], nodes: result[2], pv: result.slice(7) });
}
const report = { wasm: file, pvs: options.pvs || 'artifact default',
  forcing: options.forcing || 'artifact default',
  sha256: createHash('sha256').update(bytes).digest('hex'), results };
if (options.output) {
  mkdirSync(dirname(options.output), { recursive: true });
  writeFileSync(options.output, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));

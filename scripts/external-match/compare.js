import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSync, SearchEngine } from '../../src/ai/wasm/gomoku_engine.js';
import { replay } from '../selfplay/core.js';
import { verifyForcingLine } from './tactics.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const opts = { input: '.selfplay/external-rapfi-depth6/analysis-expanded/report.json', output: '.selfplay/external-rapfi-depth6/comparison.json' };
for (const arg of process.argv.slice(2)) {
  const m = /^--(input|output)=(.+)$/.exec(arg);
  if (!m) throw new Error(`Unknown argument: ${arg}`);
  opts[m[1]] = m[2];
}
const bytes = readFileSync(path.resolve(root, opts.input)), analysis = JSON.parse(bytes);
const wasm = readFileSync(new URL('../../src/ai/wasm/gomoku_engine_bg.wasm', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
if (sha(wasm) !== analysis.config.wasmSha256) throw new Error('Analysis used a different Wasm engine');
initSync({ module: wasm });

function childSearch(row, move, depth) {
  const { board } = replay([...row.prefix, move]);
  const black = new Uint32Array(8), white = new Uint32Array(8);
  board.forEach((c, p) => { if (c) (c === 1 ? black : white)[p >>> 5] |= 1 << (p & 31); });
  const search = new SearchEngine(black, white, row.color === 'black', depth - 1, 4, 32768);
  try {
    const result = search.fixed_depth(depth - 1, false, -2000000, 2000000);
    const raw = result[1], mate = Math.abs(raw) >= 1000000 - 225;
    return { move, depth, score: mate ? raw - Math.sign(raw) : raw, nodes: result[2], pv: [move, ...result.slice(7, 7 + result[6])] };
  } finally { search.free(); }
}

const comparisons = [];
for (const row of analysis.probes) {
  if (row.kind !== 'open-four-defense' || row.searches.every(s => s.pv[0] === row.move)) continue;
  const item = { id: row.id, pair: row.pair, game: row.game, ply: row.ply, color: row.color, prefix: row.prefix, playedMove: row.move, results: [] };
  for (const s of row.searches) {
    if (s.pv[0] === row.move) continue;
    const played = childSearch(row, row.move, s.requestedDepth);
    const alternative = childSearch(row, s.pv[0], s.requestedDepth);
    const witness = s.score >= 1000000 - 225 ? verifyForcingLine(row.prefix, row.color === 'black' ? 1 : 2, s.pv) : null;
    const losingWitness = played.score <= -1000000 + 225
      ? verifyForcingLine([...row.prefix, row.move], row.color === 'black' ? 2 : 1, played.pv.slice(1)) : null;
    item.results.push({ rootSearch: s, played, alternative, continuousFourProof: witness, shortcutLossProof: losingWitness });
  }
  comparisons.push(item);
  console.log(`${row.id}: ${item.results.map(r => `d${r.rootSearch.requestedDepth} played=${r.played.score}, alternative=${r.alternative.score}`).join('; ')}`);
}
const firstDefense = new Map();
for (const row of analysis.probes) if (row.kind === 'open-four-defense') {
  const key = `${row.pair}-${row.game}`;
  if (!firstDefense.has(key) || firstDefense.get(key).ply > row.ply) firstDefense.set(key, row);
}
const summary = { probes: analysis.probes.length, firstDefenses: firstDefense.size,
  firstDefenseDifferent: Object.fromEntries(analysis.config.depths.map(depth => [depth, [...firstDefense.values()].filter(r => r.searches.find(s => s.requestedDepth === depth)?.pv[0] !== r.move).length])),
  winningAlternatives: comparisons.filter(c => c.results.some(r => r.rootSearch.score >= 1000000 - 225 && r.alternative.score >= 1000000 - 225)).map(c => c.id),
  independentlyProvenShortcutLosses: comparisons.filter(c => c.results.some(r => r.shortcutLossProof?.proven)).map(c => c.id),
  losingShortcutWithWinningAlternative: comparisons.filter(c => c.results.some(r => r.played.score <= -1000000 + 225 && r.alternative.score >= 1000000 - 225)).map(c => c.id) };
const output = path.resolve(root, opts.output);
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ inputSha256: sha(bytes), wasmSha256: sha(wasm),
  comparatorSha256: sha(readFileSync(fileURLToPath(import.meta.url)).toString().replaceAll('\r\n', '\n')),
  tacticsSha256: sha(readFileSync(new URL('./tactics.js', import.meta.url)).toString().replaceAll('\r\n', '\n')),
  summary, comparisons }, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));

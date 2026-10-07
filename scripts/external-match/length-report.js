import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { replay } from '../selfplay/core.js';
import { compareLengths } from './lengths.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
const opts = { baseline: '.selfplay/external-rapfi-depth6/report.json',
  current: '.selfplay/external-rapfi-searched-defense-depth6/report.json',
  output: '.selfplay/external-rapfi-searched-defense-depth6/length-comparison.json',
  allowDepthChange: false };
for (const arg of process.argv.slice(2)) {
  if (arg === '--allow-depth-change') { opts.allowDepthChange = true; continue; }
  const m = /^--(baseline|current|output)=(.+)$/.exec(arg);
  if (!m) throw new Error(`Unknown argument: ${arg}`);
  opts[m[1]] = m[2];
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const load = file => {
  const bytes = readFileSync(path.resolve(root, file)), report = JSON.parse(bytes);
  for (const game of report.gamesDetail) {
    const state = replay(game.moves);
    const winner = state.winner === 1 ? game.black : state.winner === 2 ? game.white : null;
    if (!state.terminal || winner !== game.winningEngine || game.turns.length > game.moves.length) throw new Error('Invalid recorded game');
    const start = game.moves.length - game.turns.length;
    for (let i = 0; i < game.turns.length; i++) {
      const turn = game.turns[i], ply = start + i;
      if (turn.position !== game.moves[ply] || turn.player !== (ply % 2 ? game.white : game.black)) throw new Error('Invalid recorded turn');
    }
  }
  return { report, sha256: sha(bytes), file };
};
const baseline = load(opts.baseline), current = load(opts.current);
if ((baseline.report.config['candidate-width'] ?? 0) !== (current.report.config['candidate-width'] ?? 0)) throw new Error('Settings differ: candidate-width');
for (const key of ['games', 'seed', 'depth', 'rapfi-depth', 'turn-seconds', 'threads', 'rule', 'boardSize', 'opponent-name']) {
  if (key === 'depth' && opts.allowDepthChange) continue;
  if (baseline.report.config[key] !== current.report.config[key]) throw new Error(`Settings differ: ${key}`);
}
if (JSON.stringify(baseline.report.config.rapfi) !== JSON.stringify(current.report.config.rapfi) ||
    baseline.report.config.manager.sha256 !== current.report.config.manager.sha256) throw new Error('Opponent or manager differs');
const result = { baselineFile: baseline.file, baselineSha256: baseline.sha256,
  currentFile: current.file, currentSha256: current.sha256,
  depthComparison: { baseline: baseline.report.config.depth,
    current: current.report.config.depth, allowDepthChange: opts.allowDepthChange },
  analyzerSha256: sha(['./length-report.js', './lengths.js', '../selfplay/core.js'].map(p =>
    readFileSync(new URL(p, import.meta.url), 'utf8').replaceAll('\r\n', '\n')).join('\n')),
  ...compareLengths(baseline.report.gamesDetail, current.report.gamesDetail) };
const output = path.resolve(root, opts.output);
if ([opts.baseline, opts.current].some(p => path.resolve(root, p).toLowerCase() === output.toLowerCase())) throw new Error('Output cannot overwrite an input report');
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ beforeLosses: result.baseline.losses, afterLosses: result.current.losses,
  matchedLossDelta: result.matchedLossDelta, byColor: result.matchedLossDeltaByColor }, null, 2));
console.log(`Report: ${output}`);

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSync, evaluate_position, generate_candidates } from '../../src/ai/wasm/gomoku_engine.js';

// Measures how well our static evaluation ranks Rapfi's move among our own
// candidates, versus the density priority that actually drives candidate
// retention. This is the unbiased eval-quality metric the project never took:
// every earlier evaluation comparison used self-play, which is relative and
// misled the pattern-net result. See docs/strategic-diagnostic.md.
const root = fileURLToPath(new URL('../../', import.meta.url));
const options = {
  input: '.selfplay/external-rapfi-depth6/report.json',
  strategic: '.selfplay/strategic-d6/strategic.json',
  output: '.selfplay/eval-rank-d6',
};
for (const arg of process.argv.slice(2)) {
  if (arg === '--help') {
    console.log(
      'node scripts/external-match/eval-rank.js [--input=DIR/report.json] [--strategic=strategic.json] [--output=DIR]\n' +
        "For every scored decision in the strategic diagnostic, generates our candidates and ranks Rapfi's move by\n" +
        'our static evaluation and by our density priority, plus our own played move for reference.\n' +
        'Run scripts/external-match/strategic.js first to produce the --strategic input.',
    );
    process.exit(0);
  }
  const match = /^--(input|strategic|output)=(.+)$/.exec(arg);
  if (!match) throw new Error(`Unknown argument: ${arg}`);
  options[match[1]] = match[2];
}
const reportBytes = readFileSync(path.resolve(root, options.input));
const report = JSON.parse(reportBytes);
const data = JSON.parse(readFileSync(path.resolve(root, options.strategic), 'utf8'));
const wasm = readFileSync(new URL('../../src/ai/wasm/gomoku_engine_bg.wasm', import.meta.url));
initSync({ module: wasm });
const games = new Map(report.gamesDetail.map((g) => [`${g.pair}-${g.index}`, g]));

function bits(moves, upto, extra) {
  const black = new Uint32Array(8), white = new Uint32Array(8);
  const seq = moves.slice(0, upto);
  if (extra !== undefined) seq.push(extra);
  seq.forEach((p, i) => (i % 2 === 0 ? black : white)[p >>> 5] |= 1 << (p & 31));
  return [black, white];
}

const evalRanks = [], priorityRanks = [], playedRanks = [];
let counted = 0, missing = 0, candidates = 0;
for (const decision of data.decisions) {
  if (decision.rafi === null || decision.drop === null) continue;
  const game = games.get(`${decision.pair}-${decision.game}`);
  if (!game) continue;
  const ourBlack = game.black === 'Gomoku';
  const [black, white] = bits(game.moves, decision.ply);
  let packed;
  try {
    packed = generate_candidates(black, white, ourBlack);
  } catch {
    missing++;
    continue;
  }
  const rows = [];
  for (let i = 0; i < packed.length; i += 3) {
    const position = packed[i];
    const [cb, cw] = bits(game.moves, decision.ply, position);
    rows.push({ position, priority: packed[i + 1], value: evaluate_position(cb, cw, ourBlack) });
  }
  candidates += rows.length;
  const byEval = [...rows].sort((a, b) => b.value - a.value);
  const byPriority = [...rows].sort((a, b) => b.priority - a.priority);
  const rank = byEval.findIndex((r) => r.position === decision.rafi);
  if (rank < 0) {
    missing++;
    continue;
  }
  evalRanks.push(rank);
  priorityRanks.push(byPriority.findIndex((r) => r.position === decision.rafi));
  const played = byEval.findIndex((r) => r.position === decision.played);
  if (played >= 0) playedRanks.push(played);
  counted++;
}
const pct = (arr, n) => (100 * arr.filter((r) => r < n).length) / arr.length;
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
const summary = {
  counted,
  missing,
  meanCandidates: candidates / Math.max(counted, 1),
  rafi: { top1: pct(evalRanks, 1), top3: pct(evalRanks, 3), top8: pct(evalRanks, 8), meanRank: mean(evalRanks) },
  rafiByPriority: { top1: pct(priorityRanks, 1), top3: pct(priorityRanks, 3), top8: pct(priorityRanks, 8), meanRank: mean(priorityRanks) },
  played: { top1: pct(playedRanks, 1), top3: pct(playedRanks, 3), top8: pct(playedRanks, 8), meanRank: mean(playedRanks) },
};
const output = path.resolve(root, options.output);
mkdirSync(output, { recursive: true });
writeFileSync(
  path.join(output, 'report.json'),
  JSON.stringify(
    {
      inputSha256: createHash('sha256').update(reportBytes).digest('hex'),
      wasmSha256: createHash('sha256').update(wasm).digest('hex'),
      summary,
      evalRanks,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify(summary, null, 2));

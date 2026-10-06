import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSync, select_root, SearchEngine } from '../../src/ai/wasm/gomoku_engine.js';
import { createLineBitboards, findOpenFourSquares, threatMovesFromBitboard } from '../../src/ai/line-bitboards.js';
import { replay, winnerAfter } from '../selfplay/core.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const options = { input: '.selfplay/external-rapfi-depth6/report.json', output: '.selfplay/external-rapfi-depth6/analysis', 'probe-limit': 12, depths: '6,8' };
for (const arg of process.argv.slice(2)) {
  const m = /^--([^=]+)=(.+)$/.exec(arg);
  if (!m || !Object.hasOwn(options, m[1])) throw new Error(`Unknown option: ${arg}`);
  options[m[1]] = m[1] === 'probe-limit' ? Number(m[2]) : m[2];
}
const depths = options.depths.split(',').map(Number);
if (!Number.isInteger(options['probe-limit']) || options['probe-limit'] < 0 || options['probe-limit'] > 1000 ||
    !depths.length || depths.some(d => !Number.isInteger(d) || d < 1 || d > 10)) throw new Error('Invalid probe limits/depths');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const input = readFileSync(path.resolve(root, options.input));
const match = JSON.parse(input);
const wasm = readFileSync(new URL('../../src/ai/wasm/gomoku_engine_bg.wasm', import.meta.url));
initSync({ module: wasm });
const out = path.resolve(root, options.output);
mkdirSync(out, { recursive: true });
const config = { inputSha256: sha(input), wasmSha256: sha(wasm), depths, probeLimit: options['probe-limit'], extension: 4, tableCapacity: 32768,
  analyzerSha256: sha(readFileSync(fileURLToPath(import.meta.url)).toString().replaceAll('\r\n', '\n')) };
if (existsSync(path.join(out, 'config.json')) && JSON.stringify(JSON.parse(readFileSync(path.join(out, 'config.json')))) !== JSON.stringify(config)) {
  throw new Error('Analysis settings or inputs changed; use a new output directory');
}
writeFileSync(path.join(out, 'config.json'), JSON.stringify(config, null, 2) + '\n');

function boards(board) {
  const b = new Uint32Array(8), w = new Uint32Array(8);
  board.forEach((color, p) => { if (color) (color === 1 ? b : w)[p >>> 5] |= 1 << (p & 31); });
  return [b, w];
}
// Independent literal-square win check; does not depend on engine threat caches.
function wins(board, color) {
  const result = [];
  for (let p = 0; p < 225; p++) if (!board[p]) {
    board[p] = color;
    if (winnerAfter(board, p)) result.push(p);
    board[p] = 0;
  }
  return result;
}
const decisions = [], losses = [];
for (const game of match.gamesDetail) {
  const state = replay(game.moves);
  const expected = state.winner === 1 ? game.black : state.winner === 2 ? game.white : null;
  if (expected !== game.winningEngine || !state.terminal) throw new Error('Invalid saved game');
  if (game.winningEngine !== 'Rapfi') continue;
  const board = new Uint8Array(225), own = game.black === 'Gomoku' ? 1 : 2;
  const rows = [];
  game.moves.forEach((move, ply) => {
    if (ply >= 4 && (ply % 2 ? 2 : 1) === own) {
      const ownWins = wins(board, own), enemyWins = wins(board, 3 - own);
      const [black, white] = boards(board), rootMove = select_root(black, white, own === 1, false);
      const lines = createLineBitboards(black, white);
      const ownOpen = threatMovesFromBitboard(findOpenFourSquares(own === 1 ? lines.black : lines.white, own === 1 ? lines.white : lines.black), 0).map(m => m.position);
      const enemyOpen = threatMovesFromBitboard(findOpenFourSquares(own === 1 ? lines.white : lines.black, own === 1 ? lines.black : lines.white), 0).map(m => m.position);
      const kind = ownWins.length ? 'immediate-win' : enemyWins.length === 1 ? 'mandatory-block' : enemyWins.length > 1 ? 'multiple-winning-threats'
        : ownOpen.length ? 'create-open-four' : enemyOpen.length ? 'open-four-defense' : 'search';
      const row = { id: `${game.pair}-${game.index}-${ply}`, pair: game.pair, game: game.index, ply, color: own === 1 ? 'black' : 'white',
        move, rootMove, kind, ownWins, enemyWins, ownOpen, enemyOpen, prefix: game.moves.slice(0, ply) };
      board[move] = own;
      row.enemyWinsAfter = wins(board, 3 - own);
      board[move] = 0;
      rows.push(row); decisions.push(row);
    }
    board[move] = ply % 2 ? 2 : 1;
  });
  const firstDouble = rows.findIndex(row => row.enemyWins.length >= 2 && !row.ownWins.length);
  const lastDecision = firstDouble > 0 ? rows[firstDouble - 1] : rows.at(-1);
  losses.push({ pair: game.pair, game: game.index, plies: game.moves.length,
    firstUnanswerablePly: firstDouble >= 0 ? rows[firstDouble].ply : null,
    probeDecision: lastDecision?.id });
}
const counts = {};
for (const row of decisions) counts[row.kind] = (counts[row.kind] ?? 0) + 1;
const summary = { losses: losses.length, decisions: decisions.length, counts,
  missedImmediateWins: decisions.filter(r => r.ownWins.length && !r.ownWins.includes(r.move)).map(r => r.id),
  missedSingleBlocks: decisions.filter(r => !r.ownWins.length && r.enemyWins.length === 1 && r.move !== r.enemyWins[0]).map(r => r.id),
  rootMismatch: decisions.filter(r => r.rootMove >= 0 && r.rootMove !== r.move).map(r => r.id),
  lossesWithDoubleThreat: losses.filter(l => l.firstUnanswerablePly !== null).length };
writeFileSync(path.join(out, 'scan.json'), JSON.stringify({ config, summary, losses, decisions }, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));

// First test heuristic defenses; then the last decision before an unanswerable fork.
const preferred = losses.map(l => decisions.find(r => r.pair === l.pair && r.game === l.game && r.kind === 'open-four-defense' && !r.enemyWins.length))
  .filter(Boolean);
const targets = [...new Map([...preferred, ...losses.map(l => decisions.find(r => r.id === l.probeDecision)).filter(Boolean)].map(r => [r.id, r])).values()]
  .slice(0, options['probe-limit']);
const probes = [];
for (const row of targets) {
  const file = path.join(out, `${row.id}.json`);
  if (existsSync(file)) { probes.push(JSON.parse(readFileSync(file))); continue; }
  const { board } = replay(row.prefix), [black, white] = boards(board);
  const probe = { ...row, searches: [] };
  const start = performance.now();
  for (const depth of depths) {
    const search = new SearchEngine(black, white, row.color === 'black', depth, 4, 32768);
    try {
      let final, nodes = 0;
      for (;;) { const iteration = search.next_depth(); if (!iteration.length) break; final = iteration; nodes += iteration[2]; }
      if (!final) throw new Error('Missing probe search');
      probe.searches.push({ requestedDepth: depth, completedDepth: final[0], score: final[1], nodes, pv: Array.from(final.slice(7, 7 + final[6])) });
    } finally { search.free(); }
  }
  probe.milliseconds = performance.now() - start;
  writeFileSync(file, JSON.stringify(probe, null, 2) + '\n');
  probes.push(probe);
  console.log(`${row.id} ${row.kind}: played ${row.move}, ${probe.searches.map(s => `d${s.requestedDepth}: ${s.pv[0]} (${s.score})`).join('; ')} [${Math.round(probe.milliseconds)}ms]`);
}
writeFileSync(path.join(out, 'report.json'), JSON.stringify({ config, summary, probes }, null, 2) + '\n');
console.log(`Analysis: ${out}`);

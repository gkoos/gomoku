import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { initSync, solve_vcf } from '../src/ai/wasm/gomoku_engine.js';
import { verifyForcingLine } from './external-match/tactics.js';
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const m = /^--(input|output)=(.+)$/.exec(arg);
  if (!m) throw new Error(`Unknown option: ${arg}`);
  return [m[1], m[2]];
}));
const input = args.input ?? '.selfplay/external-rapfi-searched-defense-depth6/report.json';
const output = args.output ?? '.selfplay/vcf-probes.json';
const bytes = readFileSync(input), games = JSON.parse(bytes).gamesDetail;
const wasm = readFileSync(new URL('../src/ai/wasm/gomoku_engine_bg.wasm', import.meta.url));
initSync({ module: wasm });
const sha = value => createHash('sha256').update(value).digest('hex');
const proofs = [], exhausted = [], times = [];
let nodes = 0;
for (const game of games) {
  const black = new Uint32Array(8), white = new Uint32Array(8);
  for (let ply = 0; ply < game.moves.length; ply++) {
    const color = ply % 2 ? 'white' : 'black';
    if (ply >= 4 && game[color] === 'Gomoku') {
      const start = performance.now();
      const result = solve_vcf(black, white, color === 'black', 15, 2048);
      times.push(performance.now() - start); nodes += result[1];
      const id = `${game.pair}-${game.index}-${ply}`;
      if (result[2]) exhausted.push(id);
      if (result[0]) {
        const line = Array.from(result.slice(4, 4 + result[3]));
        const proof = verifyForcingLine(game.moves.slice(0, ply), color === 'black' ? 1 : 2, line);
        if (!proof.proven) throw new Error(`Invalid VCF certificate: ${id}`);
        proofs.push({ id, nodes: result[1], line, played: game.moves[ply], winningEngine: game.winningEngine });
      }
    }
    const p = game.moves[ply]; (ply % 2 ? white : black)[p >>> 5] |= 1 << (p & 31);
  }
}
times.sort((a, b) => a - b);
const summary = { positions: times.length, proofs: proofs.length,
  longerThanOneMove: proofs.filter(p => p.line.length > 1).length,
  missedWinningPositionsInLosses: proofs.filter(p => p.winningEngine && p.winningEngine !== 'Gomoku' && p.line[0] !== p.played).length,
  exhausted: exhausted.length, nodes,
  meanMilliseconds: times.reduce((a, b) => a + b, 0) / times.length,
  p95Milliseconds: times[Math.ceil(times.length * 0.95) - 1], maxMilliseconds: times.at(-1) };
if (path.resolve(input).toLowerCase() === path.resolve(output).toLowerCase()) throw new Error('Output cannot overwrite input');
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ input, inputSha256: sha(bytes), wasmSha256: sha(wasm),
  maxPlies: 15, nodeBudget: 2048, summary, proofs, exhausted }, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));

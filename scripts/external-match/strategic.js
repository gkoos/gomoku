import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRafiClient } from '../selfplay/rafi.js';

// Uses Rapfi as an external oracle on our own losses: at each of our decisions it
// asks Rapfi what it would play and how it evaluates our move versus that move.
// The drop (our value minus Rapfi's value) locates the first strategically wrong
// quiet decision in each game, which is where the evaluation, not the tactics,
// failed. See docs/timeline.md.
const root = fileURLToPath(new URL('../../', import.meta.url));
const options = {
  input: '.selfplay/external-rapfi-depth6/report.json',
  output: '.selfplay/strategic-diagnostic',
  rafi: 'download/rapfi/pbrain-rapfi-windows-sse.exe',
  'rafi-time': 100,
  threshold: 100,
  games: 0,
};
for (const arg of process.argv.slice(2)) {
  if (arg === '--help') {
    console.log(
      'node scripts/external-match/strategic.js [--input=DIR/report.json] [--output=DIR] [--rafi=PATH] [--rafi-time=100] [--threshold=100] [--games=0]\n' +
        "For each of our decisions in the match's losses, asks Rapfi what it would play and how it evaluates our move versus its own.\n" +
        "Reports the eval drop per decision (our value minus Rapfi's value) and the first decision per game above --threshold.\n" +
        "--games=0 analyses every loss; a positive value limits it. Values use Rapfi's side-to-move eval, mate scores scaled to ~1e6.",
    );
    process.exit(0);
  }
  const match = /^--(input|output|rafi|rafi-time|threshold|games)=(.+)$/.exec(arg);
  if (!match) throw new Error(`Unknown argument: ${arg}`);
  options[match[1]] = ['input', 'output', 'rafi'].includes(match[1]) ? match[2] : Number(match[2]);
}
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const inputBytes = readFileSync(path.resolve(root, options.input));
const report = JSON.parse(inputBytes);
const MATE = 1_000_000;
// Rapfi prints "Eval <int>" or "Eval [+-]M<plies>"; both are side-to-move perspective.
function evalValue(text) {
  if (text === null || text === undefined) return null;
  const mate = /^([+-]?)M(\d+)$/.exec(text);
  if (mate) return (mate[1] === '-' ? -1 : 1) * (MATE - Number(mate[2]));
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}
// Piskvork board: our engine plays black on even plies (black always opens).
function boardCommand(moves) {
  const lines = ['BOARD'];
  moves.forEach((p, ply) => lines.push(`${p % 15},${Math.floor(p / 15)},${ply % 2 === 0 ? 1 : 2}`));
  lines.push('DONE');
  return lines.join('\n') + '\n';
}

const losses = report.gamesDetail.filter((g) => g.winningEngine && g.winningEngine !== 'Gomoku');
const selected = options.games ? losses.slice(0, options.games) : losses;
const client = createRafiClient({ exe: path.resolve(root, options.rafi), timeoutMs: options['rafi-time'] });
const decisions = [];
const games = [];
let missing = 0;
for (const game of selected) {
  const own = game.black === 'Gomoku' ? 1 : 2;
  const rows = [];
  for (let ply = 4; ply < game.moves.length; ply++) {
    if ((ply % 2 ? 2 : 1) !== own) continue;
    const prefix = game.moves.slice(0, ply);
    const played = game.moves[ply];
    const before = await client.query(boardCommand(prefix));
    const rafi = before.move ? Number(before.move.split(',')[1]) * 15 + Number(before.move.split(',')[0]) : null;
    const playedEval = (await client.query(boardCommand([...prefix, played]))).eval;
    const playedValue = playedEval === null ? null : -evalValue(playedEval);
    let rafiValue = playedValue;
    if (rafi !== null && rafi !== played) {
      const rafiEval = (await client.query(boardCommand([...prefix, rafi]))).eval;
      rafiValue = rafiEval === null ? null : -evalValue(rafiEval);
    }
    const drop = playedValue === null || rafiValue === null ? null : rafiValue - playedValue;
    if (drop === null) missing++;
    rows.push({
      pair: game.pair, game: game.index, ply, color: own === 1 ? 'black' : 'white', played, rafi,
      agree: rafi === played, before: evalValue(before.eval), playedValue, rafiValue, drop,
    });
  }
  decisions.push(...rows);
  const first = rows.find((r) => r.drop !== null && r.drop >= options.threshold);
  games.push({
    pair: game.pair, game: game.index, plies: game.moves.length, decisions: rows.length,
    agree: rows.filter((r) => r.agree).length, firstBadPly: first ? first.ply : null, firstBadDrop: first ? first.drop : null,
  });
  console.log(`pair ${game.pair} game ${game.index}: ${rows.length} decisions, ${rows.filter((r) => r.agree).length} agree, first drop>=${options.threshold} at ply ${first ? first.ply : '-'}`);
}
client.close();

const drops = decisions.map((r) => r.drop).filter((v) => v !== null).sort((a, b) => a - b);
const summary = {
  games: games.length,
  decisions: decisions.length,
  missing,
  agree: decisions.filter((r) => r.agree).length,
  drop: {
    median: drops.length ? drops[Math.floor((drops.length - 1) * 0.5)] : null,
    mean: drops.length ? drops.reduce((a, b) => a + b, 0) / drops.length : null,
    p90: drops.length ? drops[Math.ceil(drops.length * 0.9) - 1] : null,
    max: drops.at(-1) ?? null,
  },
  atOrAboveThreshold: decisions.filter((r) => r.drop !== null && r.drop >= options.threshold).length,
  fourTimesThreshold: decisions.filter((r) => r.drop !== null && r.drop >= 4 * options.threshold).length,
  gamesWithFirstBad: games.filter((g) => g.firstBadPly !== null).length,
  firstBadPlies: games.map((g) => g.firstBadPly).filter((v) => v !== null).sort((a, b) => a - b),
  worst: [...decisions].filter((r) => r.drop !== null).sort((a, b) => b.drop - a.drop).slice(0, 12),
};
const output = path.resolve(root, options.output);
mkdirSync(output, { recursive: true });
writeFileSync(
  path.join(output, 'strategic.json'),
  JSON.stringify(
    {
      inputSha256: sha(inputBytes),
      rafi: path.relative(root, path.resolve(root, options.rafi)).replaceAll('\\', '/'),
      rafiTime: options['rafi-time'],
      threshold: options.threshold,
      summary,
      games,
      decisions,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify(summary, null, 2));

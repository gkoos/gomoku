import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseWeights } from './core.js';

export function loadCandidates(filename) {
  const directory = path.dirname(filename);
  const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (!Array.isArray(data.candidates) || !data.candidates.length) throw new Error('Config requires a nonempty candidates array');
  const names = new Set(['control']);
  return data.candidates.map(({ name, file }) => {
    if (typeof name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(name) || names.has(name)) throw new Error(`Invalid or duplicate candidate name: ${name}`);
    names.add(name);
    if (typeof file !== 'string' || !file) throw new Error(`Candidate ${name} requires a weight file`);
    const filename = path.resolve(directory, file);
    return { name, file: filename, weights: parseWeights(JSON.parse(fs.readFileSync(filename, 'utf8'))) };
  });
}

export function summarize(name, games) {
  const totals = { a: { moves: 0, nodes: 0, milliseconds: 0 }, b: { moves: 0, nodes: 0, milliseconds: 0 } };
  let wins = 0, draws = 0, losses = 0;
  for (const game of games) {
    if (game.winningEngine === 'b') wins++;
    else if (game.winningEngine === 'a') losses++;
    else draws++;
    for (const turn of game.turns) {
      const total = totals[turn.player];
      total.moves++;
      total.nodes += turn.nodes;
      total.milliseconds += turn.milliseconds;
    }
  }
  return { name, games: games.length, wins, draws, losses,
    score: games.length ? (wins + draws / 2) / games.length : null,
    baseline: totals.a, candidate: totals.b };
}

export function table(rows) {
  const mean = (total, field) => total.moves ? (total[field] / total.moves).toFixed(field === 'nodes' ? 0 : 2) : '—';
  return [
    '| Candidate | Games | W | D | L | Score | Nodes/move | Baseline ms/move | Candidate ms/move |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map((r) => `| ${r.name} | ${r.games} | ${r.wins} | ${r.draws} | ${r.losses} | ${r.score === null ? '—' : (r.score * 100).toFixed(1) + '%'} | ${mean(r.candidate, 'nodes')} | ${mean(r.baseline, 'milliseconds')} | ${mean(r.candidate, 'milliseconds')} |`),
  ].join('\n');
}

function engineDigest(modulePath) {
  return createHash('sha256').update(fs.readFileSync(modulePath))
    .update(fs.readFileSync(path.join(path.dirname(modulePath), 'gomoku_engine_bg.wasm'))).digest('hex');
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../selfplay.js', import.meta.url)), ...args], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Self-play failed (${signal ?? code}); completed games remain resumable`)));
  });
}

export async function main(argv) {
  const args = {}, allowed = new Set(['config', 'games', 'depth', 'seeds', 'output', 'a', 'b']);
  for (const arg of argv) {
    if (arg === '--help') {
      console.log('npm run selfplay:batch -- --config=experiments/weights.json --games=100 --depth=4 --seeds=1,2,3 --output=.selfplay/weights-batch\n--games is the even game count per candidate per seed. Optional --a/--b select engine builds. A default-versus-default control is included.');
      return;
    }
    const match = /^--([^=]+)=(.+)$/.exec(arg);
    if (!match || !allowed.has(match[1]) || Object.hasOwn(args, match[1])) throw new Error(`Unknown or duplicate option: ${arg}`);
    args[match[1]] = match[2];
  }
  const integer = (value, min, max, name) => {
    if (!/^\d+$/.test(String(value))) throw new Error(`Invalid ${name}`);
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`Invalid ${name}`);
    return n;
  };
  const games = integer(args.games ?? 100, 2, 1000000, '--games');
  if (games % 2) throw new Error('--games must be even');
  const depth = integer(args.depth ?? 4, 1, 10, '--depth');
  const seeds = (args.seeds ?? '1,2,3').split(',').map((s) => integer(s, 0, 0xffffffff, '--seeds'));
  if (new Set(seeds).size !== seeds.length) throw new Error('--seeds must be unique');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const candidates = loadCandidates(path.resolve(args.config ?? path.join(root, 'experiments/weights.json')));
  const a = path.resolve(args.a ?? path.join(root, 'engine-rust/pkg/nodejs/gomoku_engine.js'));
  const b = path.resolve(args.b ?? a);
  const output = path.resolve(args.output ?? path.join(root, '.selfplay/weights-batch'));
  const plan = { version: 1, depth, seeds, a: engineDigest(a), b: engineDigest(b),
    candidates: candidates.map(({ name, weights }) => ({ name, weights })) };
  fs.mkdirSync(output, { recursive: true });
  const manifest = path.join(output, 'batch.json');
  if (fs.existsSync(manifest)) {
    if (JSON.stringify(JSON.parse(fs.readFileSync(manifest, 'utf8'))) !== JSON.stringify(plan)) throw new Error('Batch output belongs to a different configuration; choose another --output');
  } else fs.writeFileSync(manifest, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });

  const entries = [{ name: 'control', file: null }, ...candidates];
  const completed = new Map(entries.map(({ name }) => [name, []]));
  function report() {
    const rows = entries.map(({ name }) => summarize(name, completed.get(name)));
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ plan, gamesPerSeed: games, rows }, null, 2) + '\n');
    fs.writeFileSync(path.join(output, 'results.md'), table(rows) + '\n\nScore = (wins + half of draws) / games, from the candidate perspective.\nGames sharing an opening are paired; small differences require independent validation. Timings are informational.\n');
    return rows;
  }
  // All variants get exactly the same seed and opening pair IDs.
  for (const seed of seeds) for (const candidate of entries) {
    console.log(`\n${candidate.name}: seed ${seed}, depth ${depth}, ${games} games`);
    const filename = path.join(output, `${candidate.name}-seed-${seed}.jsonl`);
    await run([`--games=${games}`, `--depth=${depth}`, `--seed=${seed}`, `--a=${a}`,
      `--b=${candidate.name === 'control' ? a : b}`, `--output=${filename}`,
      ...(candidate.file ? [`--weights-b=${candidate.file}`] : [])]);
    const records = fs.readFileSync(filename, 'utf8').trimEnd().split('\n').map((line) => JSON.parse(line));
    completed.get(candidate.name).push(...records.slice(1));
    report();
  }
  console.log('\n' + table(report()));
  console.log(`\nReports: ${path.join(output, 'results.md')} and results.json`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}

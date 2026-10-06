import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { opening } from './selfplay/core.js';
import { openingText, parseGames, validatePair, report } from './external-match/core.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const defaults = { games: 100, seed: 43, depth: 6, 'rapfi-depth': 6, 'turn-seconds': 3600,
  output: '.selfplay/external-rapfi-depth6', manager: 'download/c-gomoku-cli.exe',
  engine: 'engine-rust/target/release/pbrain-gomoku.exe', rapfi: 'download/rapfi/pbrain-rapfi-windows-sse.exe' };
const opts = { ...defaults };
for (const arg of process.argv.slice(2)) {
  if (arg === '--help') {
    console.log('node scripts/external-match.js [--games=100] [--seed=43] [--depth=6] [--rapfi-depth=6]\n  [--turn-seconds=3600] [--output=DIR] [--manager=PATH] [--engine=PATH] [--rapfi=PATH]\nResume with identical arguments. Engines must already be built/downloaded.');
    process.exit(0);
  }
  const match = /^--([^=]+)=(.+)$/.exec(arg);
  if (!match || !Object.hasOwn(defaults, match[1])) throw new Error(`Unknown option: ${arg}`);
  opts[match[1]] = typeof defaults[match[1]] === 'number' ? Number(match[2]) : match[2];
}
for (const [key, min, max] of [['games', 2, 10000], ['seed', 0, 0xffffffff], ['depth', 1, 10], ['rapfi-depth', 1, 100], ['turn-seconds', 1, 86400]]) {
  if (!Number.isInteger(opts[key]) || opts[key] < min || opts[key] > max) throw new Error(`Invalid ${key}`);
}
if (opts.games % 2) throw new Error('Games must be even');
const hash = data => createHash('sha256').update(data).digest('hex');
const digest = file => hash(readFileSync(file));
const absolute = value => path.resolve(root, value);
const slash = value => value.replaceAll('\\', '/');
const manager = absolute(opts.manager), engine = absolute(opts.engine), rapfi = absolute(opts.rapfi), out = absolute(opts.output);
for (const file of [manager, engine, rapfi]) if (!existsSync(file)) throw new Error(`Missing executable: ${file}`);
// The upstream manager tokenizes engine command strings; refuse ambiguous paths.
for (const file of [engine, rapfi]) if (/[\s"']/.test(file)) throw new Error('Engine paths must not contain spaces or quotes (manager limitation)');
const rapfiDir = path.dirname(rapfi);
const assets = readdirSync(rapfiDir).filter(name => /\.(toml|bin|nnue)(\.lz4)?$/i.test(name)).sort()
  .map(name => ({ name, sha256: digest(path.join(rapfiDir, name)) }));
const config = { version: 1, ...opts, manager: { path: manager, sha256: digest(manager) },
  engine: { path: engine, sha256: digest(engine) }, rapfi: { path: rapfi, sha256: digest(rapfi), assets },
  runnerSha256: hash(['scripts/external-match.js', 'scripts/external-match/core.js', 'scripts/selfplay/core.js'].map(p => readFileSync(path.join(root, p), 'utf8').replaceAll('\r\n', '\n')).join('\n')),
  boardSize: 15, rule: 0, threads: 1, extension: 4, tableCapacity: 32768 };
mkdirSync(out, { recursive: true });
const configPath = path.join(out, 'config.json');
if (existsSync(configPath)) {
  if (JSON.stringify(JSON.parse(readFileSync(configPath))) !== JSON.stringify(config)) throw new Error('Existing run settings or binaries differ; use a new output directory');
} else {
  if (readdirSync(out).length) throw new Error('Output directory must be empty for a new run');
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}
const all = [];
for (let pair = 0; pair < opts.games / 2; pair++) {
  const dir = path.join(out, `pair-${String(pair).padStart(3, '0')}`);
  mkdirSync(dir, { recursive: true });
  const sgf = path.join(dir, 'games.sgf'), done = path.join(dir, 'complete.json');
  let elapsedMilliseconds;
  if (existsSync(done)) {
    const saved = JSON.parse(readFileSync(done));
    if (saved.sgfSha256 !== digest(sgf)) throw new Error(`Changed SGF at pair ${pair}`);
    elapsedMilliseconds = saved.elapsedMilliseconds;
    console.log(`Pair ${pair + 1}: already complete`);
  } else {
    writeFileSync(path.join(dir, 'opening.txt'), openingText(opts.seed, pair));
    // The manager appends output; truncate only this incomplete pair before retrying.
    for (const name of ['games.sgf', 'messages.txt', 'manager.log']) writeFileSync(path.join(dir, name), '');
    const args = ['-each', `tc=0/${opts['turn-seconds']}`, 'thread=1',
      '-engine', 'name=Gomoku', `cmd=${slash(engine)}`, `depth=${opts.depth}`,
      '-engine', 'name=Rapfi', `cmd=${slash(rapfi)}`, `depth=${opts['rapfi-depth']}`,
      '-rule', '0', '-boardsize', '15', '-games', '2', '-repeat', '-concurrency', '1',
      '-openings', 'file=opening.txt', 'order=sequential', '-sgf', 'games.sgf', '-msg', 'messages.txt', '-fatalerror'];
    writeFileSync(path.join(dir, 'command.json'), JSON.stringify({ executable: manager, args, cwd: dir }, null, 2) + '\n');
    console.log(`Pair ${pair + 1}/${opts.games / 2}: starting`);
    const start = Date.now();
    await new Promise((resolve, reject) => {
      const child = spawn(manager, args, { cwd: dir, windowsHide: true });
      const heartbeat = setInterval(() => console.log(`Pair ${pair + 1}: running for ${Math.round((Date.now() - start) / 1000)}s`), 30000);
      const record = data => { process.stdout.write(data); appendFileSync(path.join(dir, 'manager.log'), data); };
      child.stdout.on('data', record); child.stderr.on('data', record);
      child.on('error', error => { clearInterval(heartbeat); reject(error); });
      child.on('close', code => { clearInterval(heartbeat); code === 0 ? resolve() : reject(new Error(`Manager exited ${code}; inspect ${dir}`)); });
    });
    elapsedMilliseconds = Date.now() - start;
  }
  const games = parseGames(readFileSync(sgf, 'utf8'), opening(opts.seed, pair));
  validatePair(games);
  if (!existsSync(done)) writeFileSync(done, JSON.stringify({ sgfSha256: digest(sgf), elapsedMilliseconds }, null, 2) + '\n');
  all.push(...games.map((game, index) => ({ pair, index, ...game, sgf: path.relative(out, sgf) })));
  const summary = { config, ...report(all), completedPairs: pair + 1, requestedGames: opts.games, gamesDetail: all };
  writeFileSync(path.join(out, 'report.json.tmp'), JSON.stringify(summary, null, 2) + '\n');
  renameSync(path.join(out, 'report.json.tmp'), path.join(out, 'report.json'));
  console.log(`Gomoku: ${summary.wins}W ${summary.draws}D ${summary.losses}L; score ${(summary.score * 100).toFixed(1)}%`);
}
console.log(`Report: ${path.join(out, 'report.json')}`);

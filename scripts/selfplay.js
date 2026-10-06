import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseWeights, playGame, replay } from './selfplay/core.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const allowed = new Set(['games', 'seed', 'depth', 'a', 'b', 'weights-a', 'weights-b', 'nnue-a', 'nnue-b', 'nnue-scale', 'output']);
const args = {};
for (const arg of process.argv.slice(2)) {
  if (arg === '--help') {
    console.log('npm run selfplay -- --games=20 --depth=4 --seed=1 --output=.selfplay/matches.jsonl\nOptional NNUE: --nnue-b=model.nnue --nnue-scale=1000\nOptional: --a=path/to/gomoku_engine.js --b=path/to/gomoku_engine.js --weights-a=weights.json --weights-b=weights.json\nGames are paired with colours swapped. Reuse the same output and configuration to resume or extend a run.');
    process.exit(0);
  }
  const match = /^--([^=]+)=(.+)$/.exec(arg);
  if (!match || !allowed.has(match[1]) || Object.hasOwn(args, match[1])) throw new Error(`Unknown or duplicate option: ${arg}`);
  args[match[1]] = match[2];
}
function integer(key, fallback, min, max) {
  const n = Number(args[key] ?? fallback);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid --${key}`);
  return n;
}
const games = integer('games', 20, 2, 1000000);
if (games % 2) throw new Error('--games must be even to preserve colour pairs');
const config = { depth: integer('depth', 4, 1, 10), seed: integer('seed', 1, 0, 0xffffffff), openingVersion: 1, extension: 4, tableCapacity: 32768 };
config.runnerDigest = createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).update(fs.readFileSync(new URL('./selfplay/core.js', import.meta.url))).digest('hex');
const engines = {};
for (const player of ['a', 'b']) {
  const modulePath = path.resolve(args[player] ?? path.join(root, 'engine-rust/pkg/nodejs/gomoku_engine.js'));
  const wasmPath = path.join(path.dirname(modulePath), 'gomoku_engine_bg.wasm');
  const digest = createHash('sha256').update(fs.readFileSync(modulePath)).update(fs.readFileSync(wasmPath)).digest('hex');
  const weights = parseWeights(args[`weights-${player}`] ? JSON.parse(fs.readFileSync(args[`weights-${player}`], 'utf8')) : {});
  config[player] = { digest, weights };
  engines[player] = { ...require(modulePath) };
  if (args[`nnue-${player}`]) {
    if (args[`weights-${player}`]) throw new Error('NNUE and handcrafted weights cannot be combined');
    const model = fs.readFileSync(path.resolve(args[`nnue-${player}`]));
    const scale = Number(args['nnue-scale'] ?? 1000);
    if (!Number.isFinite(scale) || scale < 1 || scale > 100000) throw new Error('Invalid --nnue-scale');
    if (typeof engines[player].MoveEngine.with_nnue !== 'function') throw new Error('Engine needs the NNUE API; rebuild Wasm');
    engines[player].nnueModel = model;
    engines[player].nnueScale = scale;
    config[player].nnue = { digest: createHash('sha256').update(model).digest('hex'), scale };
  }
  if (typeof engines[player].MoveEngine !== 'function') throw new Error(`Engine ${player} does not expose MoveEngine; run npm run wasm:build`);
  if (typeof engines[player].MoveEngine.with_weights !== 'function' && weights.some((w, i) => w !== parseWeights()[i])) throw new Error(`Engine ${player} needs the configurable-weight API for custom weights`);
}
if (args['nnue-scale'] && !args['nnue-a'] && !args['nnue-b']) throw new Error('--nnue-scale requires a model');
const output = path.resolve(args.output ?? path.join(root, '.selfplay/matches.jsonl'));
const records = [];
if (fs.existsSync(output)) {
  const source = fs.readFileSync(output, 'utf8');
  if (!source.endsWith('\n')) throw new Error('Output has an incomplete final record; repair it before resuming');
  const lines = source.trimEnd().split('\n').map((line) => JSON.parse(line));
  const header = lines.shift();
  if (header?.type !== 'run' || header.version !== 1 || JSON.stringify(header.config) !== JSON.stringify(config)) throw new Error('Output belongs to a different configuration; choose another --output');
  for (const game of lines) {
    if (game.type !== 'game' || game.id !== records.length) throw new Error('Invalid game sequence in output');
    const state = replay(game.moves);
    const expected = state.winner === 1 ? 'black' : state.winner === 2 ? 'white' : null;
    const blackEngine = game.id % 2 === 0 ? 'a' : 'b';
    const winningEngine = expected === 'black' ? blackEngine : expected === 'white' ? (blackEngine === 'a' ? 'b' : 'a') : null;
    if (!state.terminal || expected !== game.winner || winningEngine !== game.winningEngine) throw new Error(`Invalid saved game ${game.id}`);
    records.push(game);
  }
} else {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ type: 'run', version: 1, config }) + '\n', { flag: 'wx' });
}
for (let id = records.length; id < games; id++) {
  const game = playGame(engines, config, id);
  fs.appendFileSync(output, JSON.stringify(game) + '\n');
  records.push(game);
  console.log(`Game ${id + 1}/${games}: ${game.winningEngine ? `${game.winningEngine} wins as ${game.winner}` : 'draw'}; ${game.moves.length} plies`);
}
const summary = { games: records.length, aWins: 0, bWins: 0, draws: 0, a: { moves: 0, nodes: 0, milliseconds: 0 }, b: { moves: 0, nodes: 0, milliseconds: 0 } };
for (const game of records) {
  if (game.winningEngine) summary[`${game.winningEngine}Wins`]++; else summary.draws++;
  for (const turn of game.turns) { const total = summary[turn.player]; total.moves++; total.nodes += turn.nodes; total.milliseconds += turn.milliseconds; }
}
console.log(JSON.stringify(summary, null, 2));
console.log(`Saved: ${output}`);

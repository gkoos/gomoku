import fs from 'node:fs';
import path from 'node:path';
import { hash } from './selfplay/teacher.js';
import { CanonicalBoard } from './selfplay/dataset.js';
import { DEFAULT_WEIGHTS, replay } from './selfplay/core.js';

const args = {}, inputs = [];
for (const arg of process.argv.slice(2)) {
  const match = /^--([^=]+)=(.+)$/.exec(arg);
  if (!match) throw new Error('Use --input=file (repeatable), --dataset=directory, and --output=file');
  if (match[1] === 'input') inputs.push(path.resolve(match[2]));
  else if (['dataset', 'output'].includes(match[1]) && !Object.hasOwn(args, match[1])) args[match[1]] = match[2];
  else throw new Error(`Unknown or duplicate option: ${arg}`);
}
if (!inputs.length || !args.dataset || !args.output) throw new Error('Provide --input, --dataset, and --output');
const manifestBytes = fs.readFileSync(path.join(args.dataset, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
const knownOpenings = new Set(), trainingPositions = new Set();
function openingKey(moves) {
  const board = new CanonicalBoard();
  moves.forEach((p, i) => board.place(p, i % 2 === 0));
  return board.key(moves.length % 2 ? 'white' : 'black');
}
for (const source of manifest.provenance.sources) {
  const bytes = fs.readFileSync(source.path);
  if (hash(bytes) !== source.sha256) throw new Error('Original self-play source hash mismatch');
  for (const line of bytes.toString('utf8').trimEnd().split('\n').slice(1)) knownOpenings.add(openingKey(JSON.parse(line).opening));
}
const trainFile = path.join(args.dataset, manifest.outputs.train.file);
const trainBytes = fs.readFileSync(trainFile);
if (hash(trainBytes) !== manifest.outputs.train.sha256) throw new Error('Training split hash mismatch');
for (const line of trainBytes.toString('utf8').trimEnd().split('\n')) trainingPositions.add(JSON.parse(line).id);

const groups = new Map(), sources = [], seenFiles = new Set();
const empty = () => ({ games: 0, wins: 0, draws: 0, losses: 0 });
function count(total, game) {
  total.games++;
  if (game.winningEngine === 'b') total.wins++;
  else if (game.winningEngine === 'a') total.losses++;
  else total.draws++;
}
for (const filename of inputs) {
  const bytes = fs.readFileSync(filename), digest = hash(bytes);
  if (seenFiles.has(digest)) continue;
  seenFiles.add(digest); sources.push({ path: filename, sha256: digest });
  if (!bytes.toString('utf8').endsWith('\n')) throw new Error('Incomplete match file');
  const records = bytes.toString('utf8').trimEnd().split('\n').map((line) => JSON.parse(line));
  const header = records.shift(), config = header.config;
  if (header.type !== 'run' || header.version !== 1 || !records.length || records.length % 2 ||
      config.a.nnue || config.a.digest !== config.b.digest || JSON.stringify(config.a.weights) !== JSON.stringify(DEFAULT_WEIGHTS) ||
      JSON.stringify(config.b.weights) !== JSON.stringify(DEFAULT_WEIGHTS)) throw new Error('Expected complete paired games against the same default handcrafted engine');
  const key = JSON.stringify({ engineDigest: config.a.digest, candidate: config.b.nnue ?? 'control', depth: config.depth,
    extension: config.extension, tableCapacity: config.tableCapacity, openingVersion: config.openingVersion });
  let result = groups.get(key);
  if (!result) {
    result = { configuration: JSON.parse(key), seeds: [], all: empty(), unseenOpenings: empty(),
      canonicalOpenings: new Set(), unseenCanonicalOpenings: new Set(), gamesVisitingTrainingPosition: 0 };
    groups.set(key, result);
  }
  if (result.seeds.includes(config.seed)) throw new Error('Duplicate match seed for this model/configuration');
  result.seeds.push(config.seed);
  records.forEach((game, i) => {
    if (game.id !== i || game.type !== 'game') throw new Error('Invalid match game sequence');
    const state = replay(game.moves), winner = state.winner === 1 ? 'black' : state.winner === 2 ? 'white' : null;
    const blackEngine = i % 2 ? 'b' : 'a';
    const winningEngine = winner === 'black' ? blackEngine : winner === 'white' ? (blackEngine === 'a' ? 'b' : 'a') : null;
    if (!state.terminal || game.winner !== winner || game.winningEngine !== winningEngine || game.blackEngine !== blackEngine ||
        game.opening.some((p, j) => p !== game.moves[j])) throw new Error('Invalid saved game result');
    if (i % 2 && JSON.stringify(game.opening) !== JSON.stringify(records[i - 1].opening)) throw new Error('Opening pair differs');
    const key = openingKey(game.opening);
    result.canonicalOpenings.add(key); count(result.all, game);
    if (!knownOpenings.has(key)) { result.unseenCanonicalOpenings.add(key); count(result.unseenOpenings, game); }
    const board = new CanonicalBoard();
    let overlaps = false;
    game.moves.forEach((p, ply) => {
      if (ply >= game.opening.length && trainingPositions.has(hash(board.key(ply % 2 ? 'white' : 'black')))) overlaps = true;
      board.place(p, ply % 2 === 0);
    });
    result.gamesVisitingTrainingPosition += overlaps ? 1 : 0;
  });
}
const results = [...groups.values()].map((result) => {
  for (const total of [result.all, result.unseenOpenings]) total.scorePercent = total.games ? 100 * (total.wins + total.draws / 2) / total.games : null;
  return { ...result, canonicalOpenings: result.canonicalOpenings.size, unseenCanonicalOpenings: result.unseenCanonicalOpenings.size };
});
const report = { version: 1, datasetManifestSha256: hash(manifestBytes), sources, results,
  notes: ['Scores describe B against A. Colors are paired; canonical opening duplicates are counted in game scores.',
    'Unseen openings exclude all original dataset source openings, including validation games.',
    'The training-position overlap count checks sampled canonical boards; unseen openings can still transpose into training positions.',
    'These matches are experiments, not independent validation after repeated model selection.'] };
const output = path.resolve(args.output);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));

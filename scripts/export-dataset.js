import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DATASET_VERSION, buildDataset } from './selfplay/dataset.js';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const args = {}, inputs = [];
for (const arg of process.argv.slice(2)) {
  if (arg === '--help') {
    console.log('node scripts/export-dataset.js --input=match.jsonl --input=batch-directory --output=.selfplay/dataset\nOptions: --stride=4 --min-ply=4 --max-ply=224 --min-depth=0 --seed=1 --validation=0.2\nInputs may be repeated. Same inputs/options regenerate identical output. Related games and symmetric positions share a split.');
    process.exit(0);
  }
  const match = /^--([^=]+)=(.+)$/.exec(arg);
  if (!match) throw new Error(`Invalid option: ${arg}`);
  const [, key, value] = match;
  if (key === 'input') inputs.push(path.resolve(value));
  else {
    if (!['output', 'stride', 'min-ply', 'max-ply', 'min-depth', 'seed', 'validation'].includes(key) || Object.hasOwn(args, key)) throw new Error(`Unknown or duplicate option: ${arg}`);
    args[key] = value;
  }
}
if (!inputs.length) throw new Error('Provide at least one --input file or directory');
function integer(key, fallback, min, max) {
  const value = Number(args[key] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid --${key}`);
  return value;
}
const options = { stride: integer('stride', 4, 1, 225), minPly: integer('min-ply', 4, 0, 224),
  maxPly: integer('max-ply', 224, 0, 224), minDepth: integer('min-depth', 0, 0, 10), seed: integer('seed', 1, 0, 0xffffffff),
  validationFraction: Number(args.validation ?? 0.2) };
if (options.minPly > options.maxPly || !Number.isFinite(options.validationFraction) || options.validationFraction <= 0 || options.validationFraction >= 1) throw new Error('Invalid ply bounds or --validation fraction (must be between 0 and 1)');
const output = path.resolve(args.output ?? '.selfplay/dataset');
const files = new Set();
function collect(filename) {
  const stat = fs.lstatSync(filename);
  if (stat.isSymbolicLink()) throw new Error(`Symlink inputs are not supported: ${filename}`);
  if (stat.isDirectory()) {
    if (filename === output) return;
    for (const name of fs.readdirSync(filename).sort()) collect(path.join(filename, name));
  } else if (stat.isFile() && filename.endsWith('.jsonl')) files.add(filename);
}
inputs.forEach(collect);
if (!files.size) throw new Error('No JSONL input files found');
const sources = [], runs = [], seenContent = new Set();
for (const filename of [...files].sort()) {
  if (filename === path.join(output, 'train.jsonl') || filename === path.join(output, 'validation.jsonl')) throw new Error('Dataset outputs cannot be input files');
  const bytes = fs.readFileSync(filename), digest = hash(bytes);
  sources.push({ path: filename, sha256: digest });
  if (seenContent.has(digest)) continue;
  seenContent.add(digest);
  const source = bytes.toString('utf8');
  if (!source.endsWith('\n')) throw new Error(`Incomplete final record: ${filename}`);
  const records = source.trimEnd().split('\n').map((line, i) => {
    try { return JSON.parse(line); } catch { throw new Error(`Invalid JSON at ${filename}:${i + 1}`); }
  });
  const header = records.shift();
  const config = header?.config;
  if (header?.type !== 'run' || header.version !== 1 || !config || !Number.isInteger(config.depth) || config.depth < 1 || config.depth > 10) throw new Error(`Unsupported self-play header: ${filename}`);
  for (const player of ['a', 'b']) {
    const teacher = config[player];
    if (teacher?.nnue && (!/^[a-f0-9]{64}$/.test(teacher.nnue.digest) || !Number.isFinite(teacher.nnue.scale) || teacher.nnue.scale < 1 || teacher.nnue.scale > 100000)) throw new Error(`Invalid NNUE metadata: ${filename}`);
    if (!teacher || !/^[a-f0-9]{64}$/.test(teacher.digest) || !Array.isArray(teacher.weights) || teacher.weights.length !== 8 ||
        teacher.weights.some((w) => !Number.isInteger(w) || w < 0 || w > 100000)) throw new Error(`Invalid engine metadata: ${filename}`);
  }
  records.forEach((game, i) => { if (game.id !== i) throw new Error(`Invalid game sequence: ${filename}`); });
  runs.push({ config, games: records });
}
const exporterDigest = hash(Buffer.concat([
  fs.readFileSync(fileURLToPath(import.meta.url)), fs.readFileSync(new URL('./selfplay/dataset.js', import.meta.url)),
  fs.readFileSync(new URL('./selfplay/core.js', import.meta.url)),
]));
const provenance = { version: DATASET_VERSION, rules: 'freestyle-15', labelPerspective: 'side-to-move', options, exporterDigest, sources,
  runs: runs.map(({ config, games }) => ({ config, games: games.length })) };
const manifestFile = path.join(output, 'manifest.json');
if (fs.existsSync(output)) {
  if (!fs.existsSync(manifestFile) || JSON.stringify(JSON.parse(fs.readFileSync(manifestFile, 'utf8')).provenance) !== JSON.stringify(provenance)) throw new Error('Output belongs to a different dataset; choose another --output');
}
console.log(`Reconstructing ${runs.reduce((sum, r) => sum + r.games.length, 0)} games from ${runs.length} unique inputs...`);
const { rows, stats } = buildDataset(runs, options);
if (!rows.length) throw new Error('No positions match the sampling options');
if (!stats.splitCounts.train || !stats.splitCounts.validation) console.warn('One split is empty: too few independent groups for this split seed/fraction. Choose another seed or more games.');
fs.mkdirSync(output, { recursive: true });
const outputs = {};
for (const split of ['train', 'validation']) {
  const filename = path.join(output, `${split}.jsonl`), temporary = filename + '.tmp';
  const fd = fs.openSync(temporary, 'w'), digest = createHash('sha256');
  try {
    for (const item of rows) if (item.split === split) {
      const line = JSON.stringify(item.row) + '\n';
      fs.writeSync(fd, line); digest.update(line);
    }
  } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, filename);
  outputs[split] = { file: `${split}.jsonl`, sha256: digest.digest('hex'), positions: stats.splitCounts[split] };
}
fs.writeFileSync(manifestFile + '.tmp', JSON.stringify({ provenance, stats, outputs }, null, 2) + '\n');
fs.renameSync(manifestFile + '.tmp', manifestFile);
console.log(JSON.stringify(stats, null, 2));
console.log(`Dataset: ${output}`);

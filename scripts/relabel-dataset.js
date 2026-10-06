import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSync, SearchEngine } from '../src/ai/wasm/gomoku_engine.js';
import { hash, searchLabel, selectRows, validateLabel } from './selfplay/teacher.js';

const args = {};
for (const arg of process.argv.slice(2)) {
  if (arg === '--help') {
    console.log('node scripts/relabel-dataset.js --dataset=directory --output=directory [--depth=6 --train-limit=0 --validation-limit=0 --seed=42]\nA zero limit labels the entire split. Interrupted runs resume from labels.jsonl; inputs/configuration must match.');
    process.exit(0);
  }
  const match = /^--([^=]+)=(.+)$/.exec(arg);
  if (!match || !['dataset', 'output', 'depth', 'train-limit', 'validation-limit', 'seed'].includes(match[1]) || Object.hasOwn(args, match[1])) throw new Error(`Unknown or duplicate option: ${arg}`);
  args[match[1]] = match[2];
}
if (!args.dataset || !args.output) throw new Error('Provide --dataset and --output');
function integer(key, fallback, min, max) {
  const n = Number(args[key] ?? fallback);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`Invalid --${key}`);
  return n;
}
const source = path.resolve(args.dataset), output = path.resolve(args.output);
if (source === output) throw new Error('Teacher output must differ from its source dataset');
const bytes = fs.readFileSync(path.join(source, 'manifest.json'));
const manifest = JSON.parse(bytes.toString('utf8'));
if (manifest.provenance?.version !== 1 || manifest.provenance.rules !== 'freestyle-15' || manifest.provenance.labelPerspective !== 'side-to-move') throw new Error('Unsupported source dataset');
const wasmFile = new URL('../src/ai/wasm/gomoku_engine_bg.wasm', import.meta.url);
const wasm = fs.readFileSync(wasmFile);
const config = { depth: integer('depth', 6, 1, 10), extension: 4, tableCapacity: 32768,
  engineDigest: hash(Buffer.concat([fs.readFileSync(new URL('../src/ai/wasm/gomoku_engine.js', import.meta.url)), wasm])) };
const seed = integer('seed', 42, 0, 0xffffffff);
const limits = { train: integer('train-limit', 0, 0, 1_000_000), validation: integer('validation-limit', 0, 0, 1_000_000) };
const splits = {}, ids = new Set(), allGroups = new Set();
for (const split of ['train', 'validation']) {
  const metadata = manifest.outputs?.[split];
  if (metadata?.file !== `${split}.jsonl`) throw new Error('Invalid source dataset filename');
  const data = fs.readFileSync(path.join(source, metadata.file));
  if (hash(data) !== metadata.sha256 || !data.toString('utf8').endsWith('\n')) throw new Error('Source dataset hash or completeness mismatch');
  const rows = data.toString('utf8').trimEnd().split('\n').map((line) => JSON.parse(line));
  if (!rows.length || rows.length !== metadata.positions) throw new Error('Invalid source split count');
  const groups = new Set();
  for (const row of rows) {
    if (typeof row.id !== 'string' || typeof row.group !== 'string' || ids.has(row.id) || allGroups.has(row.group)) throw new Error('Duplicate positions or groups crossing splits');
    ids.add(row.id); groups.add(row.group);
  }
  for (const group of groups) allGroups.add(group);
  splits[split] = selectRows(rows, limits[split], seed);
}
const provenance = { ...manifest.provenance, teacher: { version: 1, sourceManifestSha256: hash(bytes),
  relabelerSha256: hash(Buffer.concat([fs.readFileSync(fileURLToPath(import.meta.url)), fs.readFileSync(new URL('./selfplay/teacher.js', import.meta.url))])),
  config, seed, limits, selection: 'seeded position hash within each existing split' } };
const journal = path.join(output, 'labels.jsonl');
const selected = Object.entries(splits).flatMap(([split, rows]) => rows.map((row) => ({ split, row })));
const labels = new Map();
if (fs.existsSync(output)) {
  if (!fs.existsSync(journal)) throw new Error('Output is not a resumable teacher dataset');
  const saved = fs.readFileSync(journal, 'utf8');
  if (!saved.endsWith('\n')) throw new Error('Incomplete teacher journal; repair the final record before resuming');
  const records = saved.trimEnd().split('\n').map((line) => JSON.parse(line));
  const header = records.shift();
  if (header.type !== 'teacher-run' || JSON.stringify(header.provenance) !== JSON.stringify(provenance)) throw new Error('Teacher output belongs to a different configuration');
  records.forEach((record, i) => {
    const item = selected[i];
    if (!item || record.id !== item.row.id || record.split !== item.split) throw new Error('Invalid teacher journal sequence');
    validateLabel(record.teacherSearch, item.row, config);
    labels.set(record.id, record.teacherSearch);
  });
} else {
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(journal, JSON.stringify({ type: 'teacher-run', provenance }) + '\n', { flag: 'wx' });
}
initSync({ module: wasm });
const started = Date.now();
let lastLog = 0;
console.log(`Teacher depth ${config.depth}: ${labels.size}/${selected.length} positions already labeled`);
for (const { split, row } of selected.slice(labels.size)) {
  const label = searchLabel({ SearchEngine }, row, config);
  validateLabel(label, row, config);
  fs.appendFileSync(journal, JSON.stringify({ split, id: row.id, teacherSearch: label }) + '\n');
  labels.set(row.id, label);
  if (Date.now() - lastLog >= 5000 || labels.size === selected.length) {
    console.log(`${labels.size}/${selected.length} labeled; ${((Date.now() - started) / 1000).toFixed(1)}s this run`);
    lastLog = Date.now();
  }
}
const outputs = {}, stats = { splitCounts: {}, sideCounts: { black: 0, white: 0 }, mateLabels: 0, depthCounts: {}, nodes: 0 };
for (const [split, rows] of Object.entries(splits)) {
  const data = rows.map((row) => {
    const teacherSearch = labels.get(row.id);
    stats.sideCounts[row.sideToMove]++;
    stats.mateLabels += teacherSearch.kind === 'mate' ? 1 : 0;
    stats.depthCounts[teacherSearch.depth] = (stats.depthCounts[teacherSearch.depth] ?? 0) + 1;
    stats.nodes += teacherSearch.nodes;
    return JSON.stringify({ ...row, teacherSearch }) + '\n';
  }).join('');
  const filename = path.join(output, `${split}.jsonl`);
  fs.writeFileSync(filename + '.tmp', data); fs.renameSync(filename + '.tmp', filename);
  outputs[split] = { file: `${split}.jsonl`, sha256: hash(data), positions: rows.length };
  stats.splitCounts[split] = rows.length;
}
const filename = path.join(output, 'manifest.json');
fs.writeFileSync(filename + '.tmp', JSON.stringify({ provenance, stats, outputs }, null, 2) + '\n');
fs.renameSync(filename + '.tmp', filename);
console.log(JSON.stringify(stats, null, 2));

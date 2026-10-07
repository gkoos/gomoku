import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { patternFeatures, PATTERN_FEATURES } from './selfplay/pattern-features.js';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const args = {};
for (const arg of process.argv.slice(2)) {
  if (arg === '--help') {
    console.log(
      'node scripts/export-pattern-dataset.js --input=.selfplay/nnue-teacher-depth6-v1 --output=.selfplay/pattern-dataset-v1\n' +
        'Turns labelled positions into pattern-histogram samples {id, label, f} where label is the\n' +
        'side-to-move win probability (outcome+1)/2 and f is PATTERN_FEATURES floats. Re-runs are byte-identical.',
    );
    process.exit(0);
  }
  const match = /^--([^=]+)=(.+)$/.exec(arg);
  if (!match || !['input', 'output'].includes(match[1]) || Object.hasOwn(args, match[1]))
    throw new Error(`Invalid option: ${arg}`);
  args[match[1]] = path.resolve(match[2]);
}
if (!args.input) throw new Error('Provide --input=<labelled dataset directory>');
const output = args.output ?? path.resolve('.selfplay/pattern-dataset-v1');
const put = (board, positions) => {
  for (const p of positions) board[p >>> 5] |= 1 << (p & 31);
};

const source = {}, splits = {};
for (const split of ['train', 'validation']) {
  const filename = path.join(args.input, `${split}.jsonl`);
  if (!fs.existsSync(filename)) throw new Error(`Missing ${filename}`);
  const bytes = fs.readFileSync(filename);
  source[split] = { file: `${split}.jsonl`, sha256: hash(bytes) };
  const rows = [];
  let skipped = 0;
  for (const line of bytes.toString('utf8').trimEnd().split('\n')) {
    const row = JSON.parse(line);
    if (!Number.isFinite(row.outcome) || !Array.isArray(row.black) || !Array.isArray(row.white)) {
      skipped++;
      continue;
    }
    const black = new Uint32Array(8), white = new Uint32Array(8);
    put(black, row.black);
    put(white, row.white);
    const features = patternFeatures(black, white, row.sideToMove).map((v) => Number(v.toFixed(6)));
    if (features.length !== PATTERN_FEATURES) throw new Error('Feature width mismatch');
    rows.push(JSON.stringify({ id: row.id, label: (row.outcome + 1) / 2, f: features }));
  }
  const content = rows.length ? rows.join('\n') + '\n' : '';
  splits[split] = { file: `${split}.jsonl`, sha256: hash(Buffer.from(content)), positions: rows.length, skipped };
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, `${split}.jsonl`), content);
}
const manifest = {
  version: 1,
  features: PATTERN_FEATURES,
  exporterDigest: hash(Buffer.concat([
    fs.readFileSync(fileURLToPath(import.meta.url)),
    fs.readFileSync(new URL('./selfplay/pattern-features.js', import.meta.url)),
  ])),
  input: args.input,
  source,
  splits,
};
const manifestFile = path.join(output, 'manifest.json');
if (fs.existsSync(manifestFile)) {
  const existing = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (existing.exporterDigest !== manifest.exporterDigest || existing.input !== manifest.input)
    throw new Error('Output belongs to a different dataset; choose another --output');
}
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(splits, null, 2));
console.log(`Pattern dataset: ${output}`);

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { patternFeatures, PATTERN_FEATURES } from './selfplay/pattern-features.js';
import { createRafiClient } from './selfplay/rafi.js';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const args = {};
for (const arg of process.argv.slice(2)) {
  if (arg === '--help') {
    console.log(
      'node scripts/export-rafi-dataset.js --input=.selfplay/nnue-teacher-depth6-v1 --output=.selfplay/rafi-dataset-v1 [--limit=2000] [--scale=1000] [--rafi=PATH] [--rafi-depth=6]\n' +
        "Labels positions with Rapfi's side-to-move evaluation (sigmoid(eval/scale)) and pattern features.",
    );
    process.exit(0);
  }
  const match = /^--([^=]+)=(.+)$/.exec(arg);
  if (!match || !['input', 'output', 'limit', 'scale', 'rafi', 'rafi-time'].includes(match[1]))
    throw new Error(`Invalid option: ${arg}`);
  args[match[1]] = match[2];
}
const rafiExe = path.resolve(args.rafi ?? 'download/rapfi/pbrain-rapfi-windows-sse.exe');
const scale = Number(args.scale ?? 1000);
const limit = Number(args.limit ?? 0);
const input = path.resolve(args.input);
const output = path.resolve(args.output ?? '.selfplay/rafi-dataset-v1');
const sigmoid = (x) => 1 / (1 + Math.exp(-x / scale));

const client = createRafiClient({ exe: rafiExe, timeoutMs: Number(args['rafi-time'] ?? 50) });
function label(evaluation) {
  if (evaluation === null) return null;
  const mate = /^([+-]?)M\d+$/.exec(evaluation);
  if (mate) return mate[1] === '-' ? 0 : 1;
  return sigmoid(Number(evaluation));
}

const source = {}, splits = {};
for (const split of ['train', 'validation']) {
  const filename = path.join(input, `${split}.jsonl`);
  const bytes = fs.readFileSync(filename);
  source[split] = { file: `${split}.jsonl`, sha256: hash(bytes) };
  const rows = [];
  let missing = 0;
  for (const line of bytes.toString('utf8').trimEnd().split('\n')) {
    if (limit && rows.length >= limit) break;
    const row = JSON.parse(line);
    const own = row.sideToMove === 'black' ? row.black : row.white;
    const opponent = row.sideToMove === 'black' ? row.white : row.black;
    const black = new Uint32Array(8), white = new Uint32Array(8);
    for (const p of row.black) black[p >>> 5] |= 1 << (p & 31);
    for (const p of row.white) white[p >>> 5] |= 1 << (p & 31);
    const features = patternFeatures(black, white, row.sideToMove).map((v) => Number(v.toFixed(6)));
    const board = ['BOARD'];
    for (const p of own) board.push(`${p % 15},${Math.floor(p / 15)},1`);
    for (const p of opponent) board.push(`${p % 15},${Math.floor(p / 15)},2`);
    board.push('DONE');
    const { eval: evaluation, move } = await client.query(board.join('\n') + '\n');
    const value = label(evaluation);
    if (value === null || move === null) { missing++; continue; }
    rows.push(JSON.stringify({ id: row.id, label: Number(value.toFixed(6)), f: features }));
  }
  const content = rows.length ? rows.join('\n') + '\n' : '';
  splits[split] = { file: `${split}.jsonl`, sha256: hash(Buffer.from(content)), positions: rows.length, missing };
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, `${split}.jsonl`), content);
  console.log(`${split}: ${rows.length} positions (${missing} missing)`);
}
client.close();
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({
  version: 1, features: PATTERN_FEATURES, scale, limit,
  exporterDigest: hash(Buffer.concat([
    fs.readFileSync(fileURLToPath(import.meta.url)),
    fs.readFileSync(new URL('./selfplay/pattern-features.js', import.meta.url)),
  ])),
  input, source, splits,
}, null, 2) + '\n');
console.log(`Rafi dataset: ${output}`);

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { generateCandidateMoves } from '../src/ai/moves.js';
import {
  boardCells,
  neighborhoodDensity,
  candidateFeatures,
  POLICY_FEATURES,
} from '../src/ai/policy.js';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const args = {};
for (const arg of process.argv.slice(2)) {
  if (arg === '--help') {
    console.log(
      'node scripts/export-policy-dataset.js --input=.selfplay/nnue-teacher-depth6-v1 --output=.selfplay/policy-dataset-v1\n' +
        'Turns teacher-labelled positions into per-candidate ordering samples. Each output row is\n' +
        '{id, ply, n, target, tac, f}: n candidates in handcrafted order, f a flat n*POLICY_FEATURES matrix,\n' +
        'and target the index (handcrafted rank) of teacherSearch.pv[0]. Re-running is byte-identical.',
    );
    process.exit(0);
  }
  const match = /^--([^=]+)=(.+)$/.exec(arg);
  if (!match || !['input', 'output'].includes(match[1]) || Object.hasOwn(args, match[1]))
    throw new Error(`Invalid option: ${arg}`);
  args[match[1]] = path.resolve(match[2]);
}
if (!args.input) throw new Error('Provide --input=<teacher dataset directory>');
const output = args.output ?? path.resolve('.selfplay/policy-dataset-v1');

const put = (board, positions) => {
  for (const p of positions) board[p >>> 5] |= 1 << (p & 31);
};
const splits = {},
  source = {};
for (const split of ['train', 'validation']) {
  const filename = path.join(args.input, `${split}.jsonl`);
  if (!fs.existsSync(filename)) throw new Error(`Missing ${filename}`);
  const bytes = fs.readFileSync(filename);
  source[split] = { file: `${split}.jsonl`, sha256: hash(bytes) };
  const lines = bytes.toString('utf8').trimEnd().split('\n');
  const rows = [];
  let positions = 0,
    missing = 0,
    tactical = 0,
    quiet = 0,
    quietOutside8 = 0,
    candidates = 0;
  for (const line of lines) {
    const row = JSON.parse(line);
    const label = row.teacherSearch;
    if (!label || !Array.isArray(label.pv) || !label.pv.length) {
      missing++;
      continue;
    }
    if (row.ply !== row.black.length + row.white.length)
      throw new Error(`Inconsistent ply for ${row.id}`);
    const black = new Uint32Array(8),
      white = new Uint32Array(8);
    put(black, row.black);
    put(white, row.white);
    const cells = boardCells(black, white);
    const density = neighborhoodDensity(cells);
    const moves = generateCandidateMoves(black, white, row.sideToMove);
    const target = moves.findIndex((m) => m.position === label.pv[0]);
    if (target < 0) {
      missing++;
      continue;
    }
    const f = [];
    for (const move of moves) {
      const features = candidateFeatures(cells, move.position, row.sideToMove, {
        priority: move.priority,
        density: density[move.position],
        tactical: move.tactical,
        ply: row.ply,
      });
      if (features.length !== POLICY_FEATURES) throw new Error('Feature width mismatch');
      for (const value of features) f.push(Number(value.toFixed(6)));
    }
    const isTactical = moves[target].tactical ? 1 : 0;
    if (isTactical) tactical++;
    else {
      quiet++;
      if (target >= 8) quietOutside8++;
    }
    candidates += moves.length;
    positions++;
    rows.push(
      JSON.stringify({ id: row.id, ply: row.ply, n: moves.length, target, tac: isTactical, f }),
    );
  }
  const content = rows.length ? rows.join('\n') + '\n' : '';
  const top = (limit) => positions - rows.filter((r) => JSON.parse(r).target >= limit).length;
  const baselineTop8 = top(8);
  splits[split] = {
    file: `${split}.jsonl`,
    sha256: hash(Buffer.from(content)),
    positions,
    missing,
    meanCandidates: positions ? Number((candidates / positions).toFixed(3)) : 0,
    baseline: {
      top1: positions ? Number((top(1) / positions).toFixed(4)) : 0,
      top8: positions ? Number((baselineTop8 / positions).toFixed(4)) : 0,
      tacticalTargets: tactical,
      quietTargets: quiet,
      quietOutsideTop8: quietOutside8,
    },
  };
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, `${split}.jsonl`), content);
}
const manifest = {
  version: 1,
  features: POLICY_FEATURES,
  featureLayout:
    'priority,density,center,tactical,ply | per direction (down,right,diag-down,diag-up): ownRun,openEnds,opponentAdjacent,ownWithin4,opponentWithin4',
  exporterDigest: hash(
    Buffer.concat([
      fs.readFileSync(fileURLToPath(import.meta.url)),
      fs.readFileSync(new URL('../src/ai/policy.js', import.meta.url)),
      fs.readFileSync(new URL('../src/ai/moves.js', import.meta.url)),
    ]),
  ),
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
console.log(`Policy dataset: ${output}`);

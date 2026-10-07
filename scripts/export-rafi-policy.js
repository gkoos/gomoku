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
import { createRafiClient } from './selfplay/rafi.js';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const args = {};
for (const arg of process.argv.slice(2)) {
  if (arg === '--help') {
    console.log(
      'node scripts/export-rafi-policy.js --input=.selfplay/nnue-teacher-depth6-v1 --output=.selfplay/rafi-policy-v1 [--limit=0] [--rafi=PATH] [--rafi-time=50]\n' +
        "Policy re-ranker samples whose target is Rapfi's chosen move (rows the engine does not generate are skipped).",
    );
    process.exit(0);
  }
  const match = /^--([^=]+)=(.+)$/.exec(arg);
  if (!match || !['input', 'output', 'limit', 'rafi', 'rafi-time'].includes(match[1]))
    throw new Error(`Invalid option: ${arg}`);
  args[match[1]] = match[2];
}
const input = path.resolve(args.input);
const output = path.resolve(args.output ?? '.selfplay/rafi-policy-v1');
const limit = Number(args.limit ?? 0);
const client = createRafiClient({
  exe: path.resolve(args.rafi ?? 'download/rapfi/pbrain-rapfi-windows-sse.exe'),
  timeoutMs: Number(args['rafi-time'] ?? 50),
});
const put = (board, positions) => {
  for (const p of positions) board[p >>> 5] |= 1 << (p & 31);
};

const source = {}, splits = {};
for (const split of ['train', 'validation']) {
  const filename = path.join(input, `${split}.jsonl`);
  const bytes = fs.readFileSync(filename);
  source[split] = { file: `${split}.jsonl`, sha256: hash(bytes) };
  const rows = [];
  let missing = 0, notGenerated = 0;
  for (const line of bytes.toString('utf8').trimEnd().split('\n')) {
    if (limit && rows.length >= limit) break;
    const row = JSON.parse(line);
    const black = new Uint32Array(8), white = new Uint32Array(8);
    put(black, row.black);
    put(white, row.white);
    const cells = boardCells(black, white);
    const density = neighborhoodDensity(cells);
    const moves = generateCandidateMoves(black, white, row.sideToMove);
    const own = row.sideToMove === 'black' ? row.black : row.white;
    const opponent = row.sideToMove === 'black' ? row.white : row.black;
    const board = ['BOARD'];
    for (const p of own) board.push(`${p % 15},${Math.floor(p / 15)},1`);
    for (const p of opponent) board.push(`${p % 15},${Math.floor(p / 15)},2`);
    board.push('DONE');
    const { move } = await client.query(board.join('\n') + '\n');
    if (!move || !/^\d+,\d+$/.test(move)) { missing++; continue; }
    const [col, r] = move.split(',').map(Number);
    const target = moves.findIndex((m) => m.position === r * 15 + col);
    if (target < 0) { notGenerated++; continue; }
    const f = [];
    for (const candidate of moves) {
      const features = candidateFeatures(cells, candidate.position, row.sideToMove, {
        priority: candidate.priority,
        density: density[candidate.position],
        tactical: candidate.tactical,
        ply: row.ply,
      });
      for (const value of features) f.push(Number(value.toFixed(6)));
    }
    rows.push(JSON.stringify({ id: row.id, ply: row.ply, n: moves.length, target, tac: moves[target].tactical ? 1 : 0, f }));
  }
  const content = rows.length ? rows.join('\n') + '\n' : '';
  splits[split] = { file: `${split}.jsonl`, sha256: hash(Buffer.from(content)), positions: rows.length, missing, notGenerated };
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, `${split}.jsonl`), content);
  console.log(`${split}: ${rows.length} positions (${missing} no move, ${notGenerated} not generated)`);
}
client.close();
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({
  version: 1, features: POLICY_FEATURES, limit,
  exporterDigest: hash(Buffer.concat([
    fs.readFileSync(fileURLToPath(import.meta.url)),
    fs.readFileSync(new URL('./selfplay/pattern-features.js', import.meta.url)),
  ])),
  input, source, splits,
}, null, 2) + '\n');
console.log(`Rafi policy dataset: ${output}`);

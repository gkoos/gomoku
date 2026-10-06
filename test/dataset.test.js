import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CanonicalBoard, decodePosition, buildDataset } from '../scripts/selfplay/dataset.js';
import { DEFAULT_WEIGHTS } from '../scripts/selfplay/core.js';

const config = { depth: 4, a: { digest: 'a'.repeat(64), weights: DEFAULT_WEIGHTS }, b: { digest: 'b'.repeat(64), weights: DEFAULT_WEIGHTS } };
const options = { minPly: 4, maxPly: 224, stride: 1, minDepth: 0, seed: 42, validationFraction: 0.5 };
const blackWin = [0, 15, 1, 16, 2, 17, 3, 18, 4];
function game(moves = blackWin, id = 0, winner = 'black') {
  const blackEngine = id % 2 ? 'b' : 'a', whiteEngine = blackEngine === 'a' ? 'b' : 'a';
  return { type: 'game', id, opening: moves.slice(0, 4), moves, blackEngine, whiteEngine,
    winner, winningEngine: winner === 'black' ? blackEngine : winner === 'white' ? whiteEngine : null,
    turns: moves.slice(4).map((position, i) => ({ position, player: i % 2 ? whiteEngine : blackEngine,
      depth: i === 0 ? 0 : 2, score: i === 0 ? null : i % 2 ? -120 : 120 })) };
}
const run = (games) => ({ config, games });

test('canonical bitboards retain colours, boundaries, and side to move under all symmetries', () => {
  const stones = [0, 31, 112, 224, 98, 143];
  let expected;
  for (let t = 0; t < 8; t++) {
    const board = new CanonicalBoard();
    stones.forEach((p, i) => {
      let r = Math.floor(p / 15), c = p % 15;
      if (t >= 4) c = 14 - c;
      for (let k = 0; k < t % 4; k++) [r, c] = [c, 14 - r];
      board.place(r * 15 + c, i % 2 === 0);
    });
    const key = board.key('black');
    expected ??= key;
    assert.equal(key, expected);
    assert.notEqual(key, board.key('white'));
    const decoded = decodePosition(key);
    assert.equal(decoded.black.length, 3);
    assert.equal(decoded.white.length, 3);
    assert.ok([...decoded.black, ...decoded.white].every((p) => p >= 0 && p < 225));
  }
});

test('labels describe the board before a move and use side-to-move outcomes', () => {
  const { rows, stats } = buildDataset([run([game()])], options);
  assert.equal(stats.uniquePositions, 5);
  assert.equal(stats.missingSearchLabels, 1);
  const first = rows.find(({ row }) => row.ply === 4).row;
  assert.equal(first.sideToMove, 'black');
  assert.equal(first.black.length + first.white.length, 4);
  assert.equal(first.outcome, 1);
  assert.deepEqual(first.searchLabels, []);
  const white = rows.find(({ row }) => row.ply === 5).row;
  assert.equal(white.outcome, -1);
  assert.equal(white.searchLabels[0].score, -120);
  assert.equal(white.searchLabels[0].engineDigest, config.b.digest);
  assert.equal(white.searchLabels[0].kind, 'evaluation');
  assert.ok(rows.every(({ row }) => row.ply < 9));
});

test('deduplication preserves conflicting outcomes and teacher labels', () => {
  const other = game([0, 15, 1, 16, 100, 17, 102, 18, 104, 19], 1, 'white');
  other.turns[0].depth = 2; other.turns[0].score = -999997;
  const { rows } = buildDataset([run([game(), other])], options);
  const first = rows.find(({ row }) => row.ply === 4).row;
  assert.equal(first.observations, 2);
  assert.deepEqual(first.outcomeCounts, { win: 1, draw: 0, loss: 1 });
  assert.equal(first.outcome, 0);
  assert.equal(first.searchLabels[0].kind, 'mate');
  assert.equal(first.searchLabels[0].engineDigest, config.b.digest);
});

test('unsampled transpositions join entire games before splitting', () => {
  const a = game(), b = game([0, 15, 2, 17, 1, 16, 3, 18, 4], 1);
  const result = buildDataset([run([a, b])], { ...options, maxPly: 4 });
  assert.equal(result.rows.length, 2);
  assert.equal(result.stats.groups, 1);
  assert.equal(result.rows[0].row.group, result.rows[1].row.group);
  assert.equal(result.rows[0].split, result.rows[1].split);
  const reverse = buildDataset([run([b, a])], { ...options, maxPly: 4 });
  assert.deepEqual(reverse, result);
});

test('rotated opening pairs cannot cross splits and invalid records fail', () => {
  const rotated = blackWin.map((p) => (p % 15) * 15 + 14 - Math.floor(p / 15));
  const result = buildDataset([run([game(), game(rotated, 1)])], options);
  assert.equal(result.stats.uniquePositions, 5);
  assert.equal(result.stats.duplicatesMerged, 5);
  assert.equal(result.stats.groups, 1);
  const corrupted = game(); corrupted.turns[1].position = 224;
  assert.throws(() => buildDataset([run([corrupted])], options), /Invalid search label/);
  const incomplete = game(); incomplete.moves = incomplete.moves.slice(0, -1);
  assert.throws(() => buildDataset([run([incomplete])], options), /inconsistent/);
});

test('even sampling strides can select either side and remain reproducible', () => {
  const sides = new Set();
  for (let seed = 0; seed < 50; seed++) {
    const settings = { ...options, stride: 4, seed };
    const result = buildDataset([run([game()])], settings);
    assert.deepEqual(result, buildDataset([run([game()])], settings));
    result.rows.forEach(({ row }) => sides.add(row.sideToMove));
  }
  assert.deepEqual([...sides].sort(), ['black', 'white']);
});

test('CLI export is reproducible, validates metadata, and protects existing datasets', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gomoku dataset '));
  try {
    const source = path.join(dir, 'matches.jsonl'), output = path.join(dir, 'dataset');
    const records = [{ type: 'run', version: 1, config }, game(), game(blackWin, 1)];
    fs.writeFileSync(source, records.map(JSON.stringify).join('\n') + '\n');
    const script = fileURLToPath(new URL('../scripts/export-dataset.js', import.meta.url));
    const execute = (extra = []) => spawnSync(process.execPath, [script, `--input=${source}`, `--output=${output}`, '--stride=1', ...extra], { encoding: 'utf8' });
    const first = execute();
    assert.equal(first.status, 0, first.stderr);
    const manifest = fs.readFileSync(path.join(output, 'manifest.json'), 'utf8');
    const train = fs.readFileSync(path.join(output, 'train.jsonl'), 'utf8');
    const validation = fs.readFileSync(path.join(output, 'validation.jsonl'), 'utf8');
    assert.equal(execute().status, 0);
    assert.equal(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'), manifest);
    assert.equal(fs.readFileSync(path.join(output, 'train.jsonl'), 'utf8'), train);
    assert.equal(fs.readFileSync(path.join(output, 'validation.jsonl'), 'utf8'), validation);
    assert.match(execute(['--seed=99']).stderr, /different dataset/);
    fs.appendFileSync(source, '{');
    assert.match(execute().stderr, /Incomplete final record/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

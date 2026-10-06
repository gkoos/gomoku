import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DEFAULT_WEIGHTS, playGame } from '../scripts/selfplay/core.js';
import { hash } from '../scripts/selfplay/teacher.js';
import { CanonicalBoard } from '../scripts/selfplay/dataset.js';

test('NNUE match report checks color pairs, input hashes, opening overlap, and training transpositions', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gomoku-nnue-report-'));
  try {
    const config = { seed: 42, depth: 2, extension: 4, tableCapacity: 32768, openingVersion: 1,
      a: { digest: 'a'.repeat(64), weights: DEFAULT_WEIGHTS },
      b: { digest: 'a'.repeat(64), weights: DEFAULT_WEIGHTS, nnue: { digest: 'b'.repeat(64), scale: 10000 } } };
    const engine = { MoveEngine: class {
      static with_weights(b, w) {
        let p = 0;
        while ((b[p >>> 5] | w[p >>> 5]) & (1 << (p & 31))) p++;
        return { root_move: () => p, free() {} };
      }
    } };
    const games = [0, 1].map((id) => playGame({ a: engine, b: engine }, config, id));
    const matchFile = path.join(directory, 'match.jsonl');
    fs.writeFileSync(matchFile, [{ type: 'run', version: 1, config }, ...games].map((r) => JSON.stringify(r) + '\n').join(''));
    const board = new CanonicalBoard();
    games[0].opening.forEach((p, i) => board.place(p, i % 2 === 0));
    const train = path.join(directory, 'train.jsonl');
    fs.writeFileSync(train, JSON.stringify({ id: hash(board.key('black')) }) + '\n');
    const manifest = { provenance: { sources: [{ path: matchFile, sha256: hash(fs.readFileSync(matchFile)) }] },
      outputs: { train: { file: 'train.jsonl', sha256: hash(fs.readFileSync(train)) } } };
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
    const output = path.join(directory, 'report.json');
    const run = () => spawnSync(process.execPath, ['scripts/nnue-match-report.js', `--input=${matchFile}`, `--input=${matchFile}`, `--dataset=${directory}`, `--output=${output}`], { encoding: 'utf8' });
    const result = run(); assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(fs.readFileSync(output));
    assert.equal(report.sources.length, 1);
    assert.equal(report.results[0].all.games, 2);
    assert.equal(report.results[0].all.scorePercent, 50);
    assert.equal(report.results[0].unseenOpenings.games, 0);
    assert.equal(report.results[0].gamesVisitingTrainingPosition, 2);
    games[1].opening = [0, 1, 2, 3];
    fs.writeFileSync(matchFile, [{ type: 'run', version: 1, config }, ...games].map((r) => JSON.stringify(r) + '\n').join(''));
    assert.match(run().stderr, /source hash mismatch/);
    manifest.provenance.sources[0].sha256 = hash(fs.readFileSync(matchFile));
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
    assert.match(run().stderr, /Invalid saved game result|Opening pair differs/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

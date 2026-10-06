import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { summarize, table, loadCandidates } from '../scripts/selfplay/batch.js';

test('batch reports candidate scores and independent per-engine costs', () => {
  const turns = [{ player: 'a', nodes: 100, milliseconds: 10 }, { player: 'b', nodes: 40, milliseconds: 3 }];
  const row = summarize('sample', [
    { winningEngine: 'b', turns }, { winningEngine: null, turns }, { winningEngine: 'a', turns },
  ]);
  assert.deepEqual([row.wins, row.draws, row.losses, row.score], [1, 1, 1, 0.5]);
  assert.deepEqual(row.baseline, { moves: 3, nodes: 300, milliseconds: 30 });
  assert.deepEqual(row.candidate, { moves: 3, nodes: 120, milliseconds: 9 });
  assert.match(table([row]), /50\.0%.*40.*10\.00.*3\.00/);
  assert.equal(summarize('empty', []).score, null);
});

test('batch shares openings, resumes, extends games, and rejects changed experiments', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gomoku batch '));
  try {
    const engine = path.join(dir, 'gomoku_engine.cjs');
    fs.writeFileSync(engine, `module.exports.MoveEngine = class {
      static with_weights(b, w) {
        let p = 0;
        while ((b[p >>> 5] | w[p >>> 5]) & (1 << (p & 31))) p++;
        return { root_move: () => p, free() {} };
      }
    };`);
    fs.writeFileSync(path.join(dir, 'gomoku_engine_bg.wasm'), 'fixture');
    const weights = path.join(dir, 'weights.json'), config = path.join(dir, 'batch.json'), output = path.join(dir, 'output');
    fs.writeFileSync(weights, JSON.stringify({ openThree: 1500 }));
    fs.writeFileSync(config, JSON.stringify({ candidates: [{ name: 'variant', file: 'weights.json' }] }));
    assert.equal(loadCandidates(config)[0].weights[3], 1500);
    const script = fileURLToPath(new URL('../scripts/selfplay/batch.js', import.meta.url));
    const run = (extra = []) => spawnSync(process.execPath, [script, `--config=${config}`, `--a=${engine}`, `--output=${output}`, '--depth=1', '--seeds=42,43', ...extra], { encoding: 'utf8' });
    let result = run(['--games=2']);
    assert.equal(result.status, 0, result.stderr);
    const get = (name, seed) => fs.readFileSync(path.join(output, `${name}-seed-${seed}.jsonl`), 'utf8');
    const control = get('control', 42), variant = get('variant', 42);
    assert.deepEqual(JSON.parse(control.split('\n')[1]).opening, JSON.parse(variant.split('\n')[1]).opening);
    assert.equal(JSON.parse(variant.split('\n')[0]).config.b.weights[3], 1500);
    const rows = JSON.parse(fs.readFileSync(path.join(output, 'results.json'), 'utf8')).rows;
    assert.deepEqual(rows.map((r) => r.games), [4, 4]);
    assert.deepEqual(rows.map((r) => r.score), [0.5, 0.5]);
    result = run(['--games=2']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(get('control', 42), control);
    assert.equal(get('variant', 42), variant);
    assert.equal(run(['--games=4']).status, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output, 'results.json'), 'utf8')).rows.map((r) => r.games), [8, 8]);
    fs.writeFileSync(weights, JSON.stringify({ openThree: 1700 }));
    assert.match(run(['--games=4']).stderr, /different configuration/);
    fs.writeFileSync(config, JSON.stringify({ candidates: [{ name: '../invalid', file: 'weights.json' }] }));
    assert.throws(() => loadCandidates(config), /Invalid or duplicate/);
    fs.writeFileSync(config, JSON.stringify({ candidates: [{ name: 'control', file: 'weights.json' }] }));
    assert.throws(() => loadCandidates(config), /Invalid or duplicate/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

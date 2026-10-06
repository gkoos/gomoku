import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('match runner resumes, extends paired games, and rejects incompatible runs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gomoku-selfplay-'));
  try {
    const modulePath = path.join(dir, 'gomoku_engine.cjs'), output = path.join(dir, 'matches.jsonl');
    fs.writeFileSync(modulePath, `module.exports.MoveEngine = class {
      static with_weights(b, w) {
        let p = 0;
        while ((b[p >>> 5] | w[p >>> 5]) & (1 << (p & 31))) p++;
        return { root_move: () => p, free() {} };
      }
    };`);
    fs.writeFileSync(path.join(dir, 'gomoku_engine_bg.wasm'), 'fixture fingerprint');
    const script = fileURLToPath(new URL('../scripts/selfplay.js', import.meta.url));
    const run = (extra = []) => spawnSync(process.execPath, [script, `--a=${modulePath}`, `--b=${modulePath}`, `--output=${output}`, '--depth=1', ...extra], { encoding: 'utf8' });
    const first = run(['--games=2']);
    assert.equal(first.status, 0, first.stderr);
    const saved = fs.readFileSync(output, 'utf8');
    assert.equal(saved.trim().split('\n').length, 3);
    assert.equal(run(['--games=2']).status, 0);
    assert.equal(fs.readFileSync(output, 'utf8'), saved);
    assert.equal(run(['--games=4']).status, 0);
    assert.equal(fs.readFileSync(output, 'utf8').trim().split('\n').length, 5);
    assert.match(run(['--seed=99', '--games=4']).stderr, /different configuration/);
    assert.match(run(['--games=3']).stderr, /must be even/);
    fs.appendFileSync(output, '{');
    assert.match(run(['--games=4']).stderr, /incomplete final record/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { initSync, SearchEngine } from '../src/ai/wasm/gomoku_engine.js';
import { hash, searchLabel, selectRows, validateLabel } from '../scripts/selfplay/teacher.js';
initSync({ module: fs.readFileSync(new URL('../src/ai/wasm/gomoku_engine_bg.wasm', import.meta.url)) });
const config = { depth: 2, extension: 4, tableCapacity: 32768, engineDigest: 'a'.repeat(64) };
const row = (black, white) => ({ black, white, ply: black.length + white.length,
  sideToMove: black.length === white.length ? 'black' : 'white' });

test('teacher labels search actual turns and preserve mate distance without root shortcuts', () => {
  for (const [position, expected] of [
    [row([112, 113, 114, 115], [0, 15, 30, 45]), 999999],
    [row([0, 2, 4, 6, 8], [112, 113, 114, 115]), 999999],
    [row([0, 2, 4, 6], [112, 113, 114, 115]), -999998],
  ]) {
    const label = searchLabel({ SearchEngine }, position, config);
    assert.equal(label.score, expected);
    assert.equal(label.depth, 1);
    assert.equal(label.kind, 'mate');
    validateLabel(label, position, config);
    assert.throws(() => validateLabel({ ...label, score: 10, kind: 'evaluation' }, position, config));
    assert.throws(() => validateLabel({ ...label, pv: [position.black[0]] }, position, config));
  }
  assert.throws(() => searchLabel({ SearchEngine }, row([112], [112]), config));
  assert.throws(() => searchLabel({ SearchEngine }, row([112, 113, 114, 115, 116], [0, 2, 4, 6]), config), /terminal/);
});

test('teacher completes quiet searches, frees failed searches, and samples reproducibly', () => {
  const position = row([112, 113], [97, 98]);
  const label = searchLabel({ SearchEngine }, position, config);
  assert.equal(label.depth, config.depth);
  validateLabel(label, position, config);
  let freed = false;
  const mock = { SearchEngine: class {
    next_depth() { throw new Error('search failed'); }
    free() { freed = true; }
  } };
  assert.throws(() => searchLabel(mock, position, config), /search failed/);
  assert.equal(freed, true);
  const rows = Array.from({ length: 20 }, (_, i) => ({ id: String(i) }));
  assert.deepEqual(selectRows(rows, 5, 42), selectRows([...rows].reverse(), 5, 42));
  assert.equal(selectRows(rows, 0, 42).length, 20);
});

test('teacher CLI resumes labels deterministically and rejects changed configuration or source hashes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gomoku-teacher-'));
  try {
    const source = path.join(directory, 'source'), output = path.join(directory, 'teacher');
    fs.mkdirSync(source);
    const outputs = {};
    for (const [split, position] of [['train', row([112, 113], [97, 98])], ['validation', row([0, 2, 4, 6], [112, 113, 114, 115])]]) {
      const data = JSON.stringify({ ...position, id: split, group: split, outcome: 0, outcomeCounts: { win: 1, draw: 0, loss: 1 }, observations: 2, searchLabels: [] }) + '\n';
      fs.writeFileSync(path.join(source, `${split}.jsonl`), data);
      outputs[split] = { file: `${split}.jsonl`, sha256: hash(data), positions: 1 };
    }
    fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify({ provenance: { version: 1, rules: 'freestyle-15', labelPerspective: 'side-to-move' }, outputs }));
    const run = (depth = 2) => spawnSync(process.execPath, ['scripts/relabel-dataset.js', `--dataset=${source}`, `--output=${output}`, `--depth=${depth}`], { encoding: 'utf8' });
    const first = run(); assert.equal(first.status, 0, first.stderr);
    const original = fs.readFileSync(path.join(output, 'manifest.json'), 'utf8');
    const journal = path.join(output, 'labels.jsonl');
    const records = fs.readFileSync(journal, 'utf8').trimEnd().split('\n');
    fs.writeFileSync(journal, records.slice(0, 2).join('\n') + '\n');
    assert.equal(run().status, 0);
    assert.equal(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'), original);
    assert.match(run(3).stderr, /different configuration/);
    fs.writeFileSync(journal, records.join('\n'));
    assert.match(run().stderr, /Incomplete teacher journal/);
    fs.appendFileSync(path.join(source, 'train.jsonl'), 'garbage\n');
    assert.match(run().stderr, /hash or completeness mismatch/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

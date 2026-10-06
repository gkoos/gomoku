import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSync, MoveEngine } from '../src/ai/wasm/gomoku_engine.js';
import { chooseMove, DEFAULT_WEIGHTS, opening, replay } from './selfplay/core.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const executable = path.join(root, 'engine-rust/target/release', process.platform === 'win32' ? 'pbrain-gomoku.exe' : 'pbrain-gomoku');
initSync({ module: readFileSync(new URL('../src/ai/wasm/gomoku_engine_bg.wasm', import.meta.url)) });
const modelArg = process.argv.slice(2).find((arg) => arg.startsWith('--nnue='));
const scaleArg = process.argv.slice(2).find((arg) => arg.startsWith('--nnue-scale='));
const reference = { MoveEngine };
if (modelArg) {
  reference.nnueModel = readFileSync(modelArg.slice('--nnue='.length));
  reference.nnueScale = Number(scaleArg?.slice('--nnue-scale='.length) ?? 1000);
}

// Keep stdin open: a buffered/unflushed handshake cannot pass this check.
const child = spawn(executable, ['--depth=2'], { stdio: ['pipe', 'pipe', 'pipe'] });
const replies = [], waiting = [];
let buffer = '', stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk; });
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  while (buffer.includes('\n')) {
    const end = buffer.indexOf('\n'), line = buffer.slice(0, end).trimEnd(); buffer = buffer.slice(end + 1);
    if (waiting.length) waiting.shift()(line); else replies.push(line);
  }
});
const read = () => Promise.race([
  replies.length ? Promise.resolve(replies.shift()) : new Promise((resolve) => waiting.push(resolve)),
  exited.then(() => { throw new Error('Native engine exited before replying'); }),
]);
const exited = new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Native engine exit ${code}: ${stderr}`))); });
const watchdog = setTimeout(() => child.kill(), 10000); // Test watchdog only, not an engine deadline.
try {
  child.stdin.write('INFO max_depth 1\r\nSTART 15\r\n');
  assert.equal(await read(), 'OK');
  child.stdin.write('BEGIN\n');
  assert.equal(await read(), '7,7');
  child.stdin.write('END\n');
  await exited;
} finally { clearTimeout(watchdog); child.kill(); }

const boards = [];
for (let i = 0; i < 24; i++) {
  const moves = opening(31415, i);
  boards.push(replay(moves).board);
  const next = [...Array(225).keys()].find((p) => !moves.includes(p));
  boards.push(replay([...moves, next]).board);
}
for (const moves of [[112,0,113,2,114,4,115,6], [0,112,2,113,4,114,6,115,8]]) boards.push(replay(moves).board);
let input = 'START 15\nINFO max_depth 2\n', expected = ['OK'];
for (const board of boards) {
  const black = board.reduce((sum, c) => sum + (c !== 0), 0) % 2 === 0;
  const move = chooseMove(reference, board, black, 2, DEFAULT_WEIGHTS).position;
  expected.push('OK', `${move % 15},${Math.floor(move / 15)}`);
  input += 'RESTART\nBOARD\n';
  // Reverse square order: BOARD encodes relative ownership, not move chronology.
  for (let p = 224; p >= 0; p--) if (board[p]) input += `${p % 15},${Math.floor(p / 15)},${(board[p] === 1) === black ? 1 : 2}\n`;
  input += 'DONE\n';
}
input += 'END\n';
const engineArgs = ['--depth=4', ...[modelArg, scaleArg].filter(Boolean)];
const result = spawnSync(executable, engineArgs, { input, encoding: 'utf8', timeout: 30000 });
assert.equal(result.status, 0, result.stderr || String(result.error));
assert.deepEqual(result.stdout.trimEnd().split(/\r?\n/), expected);
const invalid = spawnSync(executable, ['--depth=0'], { encoding: 'utf8' });
assert.equal(invalid.status, 1); assert.equal(invalid.stdout, '');
console.log(`Native protocol passed: live flushed handshake and ${boards.length} native/Wasm move comparisons, both colors, reversed BOARD order, resets, INFO depth, and invalid CLI configuration.`);

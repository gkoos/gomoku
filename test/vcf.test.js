import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { initSync, solve_vcf, MoveEngine } from '../src/ai/wasm/gomoku_engine.js';
import { solveVcf } from '../src/ai/vcf.js';
import { findBestMove } from '../src/ai/engine.js';
import { replay, winnerAfter, opening } from '../scripts/selfplay/core.js';
import { winningSquares, verifyForcingLine } from '../scripts/external-match/tactics.js';
initSync({ module: readFileSync(new URL('../src/ai/wasm/gomoku_engine_bg.wasm', import.meta.url)) });
const bits = prefix => {
  const b = new Uint32Array(8), w = new Uint32Array(8);
  prefix.forEach((p, i) => (i % 2 ? w : b)[p >>> 5] |= 1 << (p & 31));
  return [b, w];
};
const ladder = [110,109,111,0,112,14,128,210,143,224];
const unpack = r => ({ proven: r[0] === 1, nodes: r[1], exhausted: r[2] === 1, line: Array.from(r.slice(4, 4 + r[3])) });

test('VCF ladder respects limits and matches independent proofs in every symmetry/color', async () => {
  for (let t = 0; t < 8; t++) {
    const transform = p => {
      let r = Math.floor(p / 15), c = p % 15;
      if (t >= 4) c = 14 - c;
      for (let i = 0; i < t % 4; i++) [r, c] = [c, 14 - r];
      return r * 15 + c;
    };
    for (const color of ['black', 'white']) {
      const prefix = (color === 'black' ? ladder : [1, ...ladder]).map(transform);
      const [b, w] = bits(prefix), before = [...b, ...w];
      const rust = unpack(solve_vcf(b, w, color === 'black', 5, 2048));
      assert.deepEqual(rust, solveVcf(b, w, color, 5, 2048));
      assert.equal(rust.proven, true);
      assert.equal(verifyForcingLine(prefix, color === 'black' ? 1 : 2, rust.line).proven, true);
      assert.ok(rust.line.length <= 5);
      assert.equal(unpack(solve_vcf(b, w, color === 'black', 4, 2048)).proven, false);
      const limited = unpack(solve_vcf(b, w, color === 'black', 15, 1));
      assert.equal(limited.proven, false); assert.equal(limited.exhausted, true); assert.equal(limited.nodes, 1);
      assert.deepEqual([...b, ...w], before);
      const engine = new MoveEngine(b, w, color === 'black', 1, 4, 32768);
      try { assert.equal(engine.root_move(), solveVcf(b, w, color).line[0]); } finally { engine.free(); }
      const move = await findBestMove(b, w, color, color === 'black' ? 'white' : 'black', 'medium');
      assert.equal(move.row * 15 + move.col, solveVcf(b, w, color).line[0]);
    }
  }
});

function oracle(board, attacker, remaining) {
  if (!remaining) return false;
  const own = winningSquares(board, attacker), enemy = winningSquares(board, 3 - attacker);
  if (own.length) return true;
  if (remaining < 3 || enemy.length >= 2) return false;
  for (let p = 0; p < 225; p++) if (!board[p] && (!enemy.length || enemy[0] === p)) {
    board[p] = attacker;
    const threats = winningSquares(board, attacker);
    let won = false;
    if (threats.length && !winningSquares(board, 3 - attacker).length) {
      if (threats.length >= 2) won = true;
      else {
        board[threats[0]] = 3 - attacker;
        won = oracle(board, attacker, remaining - 2);
        board[threats[0]] = 0;
      }
    }
    board[p] = 0;
    if (won) return true;
  }
  return false;
}
test('VCF agrees with exhaustive attacker enumeration on sampled literal boards', () => {
  let seed = 1024;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let sample = 0; sample < 24; sample++) {
    const prefix = opening(72, sample), board = replay(prefix).board;
    while (prefix.length < 12 + sample % 12) {
      const p = (3 + random(9)) * 15 + 3 + random(9);
      if (board[p]) continue;
      board[p] = prefix.length % 2 ? 2 : 1;
      if (winnerAfter(board, p)) { board[p] = 0; break; }
      prefix.push(p);
    }
    const [b, w] = bits(prefix), color = prefix.length % 2 ? 'white' : 'black';
    const rust = unpack(solve_vcf(b, w, color === 'black', 5, 1000000));
    assert.deepEqual(rust, solveVcf(b, w, color, 5, 1000000));
    assert.equal(rust.exhausted, false);
    assert.equal(rust.proven, oracle(board, color === 'black' ? 1 : 2, 5));
    if (rust.proven) assert.equal(verifyForcingLine(prefix, color === 'black' ? 1 : 2, rust.line).proven, true);
  }
});
test('counter-wins, terminal positions, and invalid limits do not yield false proofs', () => {
  for (const prefix of [[110,109,111,54,112,69,128,84,143,99,39], [110,109,111,54,112,69,128,84,143,0]]) {
    const [b, w] = bits(prefix);
    assert.equal(unpack(solve_vcf(b, w, true, 5, 2048)).proven, false);
    assert.equal(solveVcf(b, w, 'black', 5, 2048).proven, false);
  }
  const [b, w] = bits([110,0,111,14,112,210,113,224,114]);
  assert.equal(unpack(solve_vcf(b, w, false, 15, 2048)).proven, false);
  assert.throws(() => solve_vcf(b, w, true, 32, 2048));
  assert.throws(() => solveVcf(b, w, 'black', 32));
});

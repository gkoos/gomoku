import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { initSync, MoveEngine, SearchEngine } from '../src/ai/wasm/gomoku_engine.js';
import { findBestMove } from '../src/ai/engine.js';
import { createWasmChooseMove, createWasmDeepSearch } from '../src/ai/wasm-search.js';
import { checkImmediateThreat } from '../src/ai/threats.js';
initSync({ module: readFileSync(new URL('../src/ai/wasm/gomoku_engine_bg.wasm', import.meta.url)) });
const bits = ps => { const b = new Uint32Array(8); for (const p of ps) b[p >>> 5] |= 1 << (p & 31); return b; };
const black = bits([126, 127, 141, 155, 128, 97, 124, 96]);
const white = bits([140, 143, 156, 113, 129, 112, 125, 115]);
const wasmMove = createWasmChooseMove({ loadEngine: () => ({ MoveEngine }) });

test('searched difficulties force a reply before defending the Rapfi fork', async () => {
  for (const color of ['black', 'white']) {
    const opponent = color === 'black' ? 'white' : 'black';
    const [b, w] = color === 'black' ? [black, white] : [white, black];
    const before = [Array.from(b), Array.from(w)];
    const easy = await wasmMove(b, w, color, opponent, 'easy');
    assert.equal(easy.row * 15 + easy.col, 157);
    for (const difficulty of ['medium', 'hard', 'expert']) {
      const iterations = [];
      const move = await wasmMove(b, w, color, opponent, difficulty, null, { onIteration: r => iterations.push(r) });
      assert.equal(move.position, 111);
      assert.equal(iterations.at(-1).depth, { medium: 6, hard: 8, expert: 10 }[difficulty]);
      assert.equal(iterations.at(-1).principalVariation[1].position, 81);
    }
    const jsIterations = [];
    const js = await findBestMove(b, w, color, opponent, 'medium', () => {}, { onIteration: r => jsIterations.push(r) });
    assert.equal(js.row * 15 + js.col, 111);
    const bridged = [];
    const bridge = await findBestMove(b, w, color, opponent, 'medium', () => {}, {
      deepSearch: createWasmDeepSearch(SearchEngine), onIteration: r => bridged.push(r),
    });
    assert.equal(bridge.position, 111);
    assert.deepEqual(bridged.map(r => [r.depth, r.score, r.nodes]), jsIterations.map(r => [r.depth, r.score, r.nodes]));
    const attackedB = b.slice(), attackedW = w.slice();
    (color === 'black' ? attackedB : attackedW)[111 >>> 5] |= 1 << (111 & 31);
    assert.deepEqual(checkImmediateThreat(attackedB, attackedW, color).map(m => m.position), [81]);
    assert.equal(checkImmediateThreat(attackedB, attackedW, opponent).length, 0);
    assert.deepEqual([Array.from(b), Array.from(w)], before);
  }
});

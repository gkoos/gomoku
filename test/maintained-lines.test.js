import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLineBitboards,
  updateLineBitboards,
} from '../src/ai/line-bitboards.js';
import {
  analyzeLinePattern,
  analyzePackedLinePattern,
} from '../src/ai/patterns.js';
import { createIncrementalEvaluator } from '../src/ai/incremental-evaluation.js';
import { evaluatePosition } from '../src/ai/evaluation.js';
import { generateCandidateMoves } from '../src/ai/moves.js';
import { checkImmediateThreat, checkOpen4Threats } from '../src/ai/threats.js';
import { minimaxAlphaBeta } from '../src/ai/search.js';
import { createSearchContext } from '../src/ai/search-context.js';

const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];
function set(board, p) {
  board[p >>> 5] |= 1 << (p & 31);
}

test('every square changes exactly four line masks and restores on undo', () => {
  const b = Array(8).fill(0),
    w = Array(8).fill(0),
    lines = createLineBitboards(b, w);
  assert.ok(lines.black instanceof Uint16Array);
  assert.equal(lines.black.length, 88);
  for (const color of ['black', 'white'])
    for (let p = 0; p < 225; p++) {
      updateLineBitboards(lines, p, color, true);
      assert.equal([...lines[color]].filter(Boolean).length, 4);
      set(color === 'black' ? b : w, p);
      assert.deepEqual(lines, createLineBitboards(b, w));
      updateLineBitboards(lines, p, color, false);
      (color === 'black' ? b : w)[p >>> 5] &= ~(1 << (p & 31));
      assert.deepEqual(lines, createLineBitboards(b, w));
    }
});

for (const direction of [0, 1, 2, 3]) {
  test(
    'packed pattern extraction matches square reads for all nine-cell states in direction ' +
      direction,
    () => {
      const [dr, dc] = DIRECTIONS[direction];
      for (let code = 0; code < 3 ** 9; code++) {
        const b = Array(8).fill(0),
          w = Array(8).fill(0);
        let value = code;
        for (let offset = -4; offset <= 4; offset++) {
          const cell = value % 3;
          value = Math.floor(value / 3);
          if (cell)
            set(cell === 1 ? b : w, (7 + dr * offset) * 15 + 7 + dc * offset);
        }
        const lines = createLineBitboards(b, w);
        assert.deepEqual(
          analyzePackedLinePattern(lines.black, lines.white, 112, direction),
          analyzeLinePattern(b, w, 7, 7, dr, dc),
        );
      }
    },
  );
}

test('packed windows preserve boundary blockers, short diagonals, and opponent precedence', () => {
  let seed = 8675309;
  for (const p of [
    0, 14, 15, 31, 32, 63, 64, 95, 96, 127, 128, 159, 160, 191, 192, 223, 224,
  ]) {
    for (let sample = 0; sample < 30; sample++) {
      const b = Array(8).fill(0),
        w = Array(8).fill(0);
      for (let i = 0; i < 70; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        set(i % 2 ? b : w, seed % 225);
      }
      // Include overlapping stones to verify opponent precedence matches the reference.
      const lines = createLineBitboards(b, w);
      for (const [own, other, ownLines, otherLines] of [
        [b, w, lines.black, lines.white],
        [w, b, lines.white, lines.black],
      ])
        for (let direction = 0; direction < 4; direction++) {
          const [dr, dc] = DIRECTIONS[direction];
          assert.deepEqual(
            analyzePackedLinePattern(ownLines, otherLines, p, direction),
            analyzeLinePattern(own, other, Math.floor(p / 15), p % 15, dr, dc),
          );
        }
    }
  }
});

test('evaluator-maintained lines match reconstruction and candidate/threat outputs through make and undo', () => {
  let seed = 314159;
  for (const perspective of ['black', 'white']) {
    const b = Array(8).fill(0),
      w = Array(8).fill(0),
      state = createIncrementalEvaluator(b, w, perspective),
      frames = [];
    const lines = state.lineBitboards;
    function verify() {
      assert.equal(state.lineBitboards, lines);
      assert.deepEqual(lines, createLineBitboards(b, w));
      assert.equal(state.getScore(), evaluatePosition(b, w, perspective));
      for (const color of ['black', 'white']) {
        assert.deepEqual(
          generateCandidateMoves(b, w, color, lines),
          generateCandidateMoves(b, w, color),
        );
        assert.deepEqual(
          checkImmediateThreat(b, w, color, lines),
          checkImmediateThreat(b, w, color),
        );
        assert.deepEqual(
          checkOpen4Threats(b, w, color, lines),
          checkOpen4Threats(b, w, color),
        );
      }
    }
    for (let i = 0; i < 100; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const p = seed % 225;
      if ((b[p >>> 5] | w[p >>> 5]) & (1 << (p & 31))) continue;
      const color = i % 2 ? 'black' : 'white';
      frames.push({ p, color, token: state.makeMove(p, color) });
      set(color === 'black' ? b : w, p);
      verify();
    }
    while (frames.length) {
      const { p, color, token } = frames.pop();
      state.undoMove(token);
      (color === 'black' ? b : w)[p >>> 5] &= ~(1 << (p & 31));
      verify();
    }
    assert.equal(state.getScore(), 0);
  }
});

test('failed moves and interrupted searches leave maintained masks unchanged', () => {
  const b = Array(8).fill(0),
    w = Array(8).fill(0);
  set(b, 112);
  set(w, 113);
  const state = createIncrementalEvaluator(b, w, 'black'),
    before = structuredClone(state.lineBitboards),
    context = createSearchContext(b, w, 'black'),
    key = context.hasher.key;
  assert.throws(() => state.makeMove(112, 'white'), /existing stone/);
  assert.throws(() => state.makeMove(225, 'black'), RangeError);
  assert.deepEqual(state.lineBitboards, before);
  let calls = 0;
  assert.throws(
    () =>
      minimaxAlphaBeta(
        b,
        w,
        3,
        -Infinity,
        Infinity,
        true,
        'black',
        'white',
        [],
        {
          reportProgress() {
            if (++calls === 2) throw new Error('interrupted');
          },
        },
        state,
        context,
      ),
    /interrupted/,
  );
  assert.deepEqual(state.lineBitboards, before);
  assert.equal(context.hasher.key, key);
});

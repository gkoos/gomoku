import assert from 'node:assert/strict';
import test from 'node:test';
import { generateCandidateMoves } from '../src/ai/moves.js';
import { selectSearchCandidates, findBestMoveDeepSearch } from '../src/ai/search.js';
import { createLineBitboards, findFourCreationSquares, findOpenFourSquares } from '../src/ai/line-bitboards.js';
import { winningSquares } from '../scripts/external-match/tactics.js';
import { replay } from '../scripts/selfplay/core.js';

const bits = positions => {
  const board = Array(8).fill(0);
  for (const p of positions) board[p >>> 5] |= 1 << (p & 31);
  return board;
};
const squares = mask => Array.from({ length: 225 }, (_, p) => p)
  .filter(p => mask[p >>> 5] & (1 << (p & 31)));

test('search follows forced counterattacks before safely covering a crossing threat', () => {
  const prefix = [0,155,2,156,4,157,210,113,212,128,214,143];
  const black = bits(prefix.filter((_, i) => i % 2 === 0));
  const white = bits(prefix.filter((_, i) => i % 2 === 1));
  let last;
  findBestMoveDeepSearch(black, white, 'black', 'white', null, 6, {
    onIteration: result => last = result,
  });
  const line = last.principalVariation.map(move => move.position);
  assert.equal(line[4], 158, 'the shared defense follows two forcing attacks');
  const board = replay(prefix).board;
  for (let i = 0; i < 4; i++) {
    const p = line[i];
    assert.equal(board[p], 0);
    if (i % 2 === 1) assert.deepEqual(winningSquares(board, 1), [p]);
    board[p] = i % 2 ? 2 : 1;
    if (i % 2 === 0) {
      assert.equal(winningSquares(board, 2).length, 0);
      assert.equal(winningSquares(board, 1).length, 1);
    }
  }
  const after = createLineBitboards(bits([...prefix.filter((_, i) => i % 2 === 0), line[0], line[2], line[4]]),
    bits([...prefix.filter((_, i) => i % 2 === 1), line[1], line[3]]));
  assert.equal(findOpenFourSquares(after.white, after.black).some(mask => mask !== 0), false);
});

test('four-creating moves survive both caps despite a crowded distant cluster', () => {
  for (const color of ['black', 'white']) {
    const own = bits([1,2,3,97,128,95,129]), other = bits([96,98,111,113,126,127,112,142]);
    const [b, w] = color === 'black' ? [own, other] : [other, own];
    const lines = createLineBitboards(b, w);
    const forcing = findFourCreationSquares(lines[color], lines[color === 'black' ? 'white' : 'black']);
    const old = generateCandidateMoves(b, w, color, lines);
    const protectedCandidates = generateCandidateMoves(b, w, color, lines, null, forcing);
    const ordinary = selectSearchCandidates(old, 10);
    const selected = selectSearchCandidates(protectedCandidates, 10, [], [], forcing);
    assert.ok([0,4,5].every(p => squares(forcing).includes(p)));
    assert.ok([0,4,5].some(p => !ordinary.some(move => move.position === p)));
    for (const p of squares(forcing)) assert.ok(selected.some(move => move.position === p));
  }
});

test('PV promotion cannot evict a protected attack and immediate tactics retain precedence', () => {
  const candidates = Array.from({ length: 30 }, (_, position) => ({ position, tactical: 0 }));
  const forcing = bits(Array.from({ length: 12 }, (_, p) => p));
  const selected = selectSearchCandidates(candidates, 10, [], [candidates[29]], forcing);
  assert.equal(selected[0].position, 29);
  assert.equal(selected.length, 13);
  for (const p of squares(forcing)) assert.ok(selected.some(move => move.position === p));
  const block = { position: 40, tactical: 1 }, win = { position: 41, tactical: 2 };
  assert.deepEqual(selectSearchCandidates([...candidates, block], 10, [], [], forcing), [block]);
  assert.deepEqual(selectSearchCandidates([...candidates, block, win], 10, [], [], forcing), [win]);
});

test('all attacks survive even when they exceed the fifty-move generation cap', () => {
  const stones = [];
  for (let row = 0; row < 15; row += 2)
    for (const col of [1,2,3,6,7,8,11,12,13]) stones.push(row * 15 + col);
  for (const color of ['black', 'white']) {
    const own = bits(stones), empty = bits([]);
    const [b,w] = color === 'black' ? [own,empty] : [empty,own];
    const lines = createLineBitboards(b,w);
    const forcing = findFourCreationSquares(lines[color], lines[color === 'black' ? 'white' : 'black']);
    const expected = squares(forcing);
    assert.ok(expected.length > 50);
    const candidates = generateCandidateMoves(b,w,color,lines,null,forcing);
    const selected = selectSearchCandidates(candidates, 10, [], [], forcing);
    for (const p of expected) assert.ok(selected.some(move => move.position === p));
  }
});

test('bitboard four masks match literal placement scans across every five-cell three pattern', () => {
  let cases = 0;
  for (const [dr, dc, start] of [[0,1,0], [1,0,0], [1,1,0], [1,-1,14]]) {
    for (let mask = 0; mask < 32; mask++) {
      if (Array.from({ length: 5 }, (_, i) => (mask >>> i) & 1).reduce((a,b) => a+b) !== 3) continue;
      const positions = Array.from({ length: 5 }, (_, i) => start + i * (dr * 15 + dc));
      const stones = positions.filter((_, i) => mask & (1 << i));
      for (const color of ['black', 'white']) {
        const own = bits(stones), empty = bits([]);
        const [b,w] = color === 'black' ? [own,empty] : [empty,own];
        const lines = createLineBitboards(b,w), other = color === 'black' ? 'white' : 'black';
        const forcing = findFourCreationSquares(lines[color], lines[other]);
        const literal = Array(225).fill(0), attacker = color === 'black' ? 1 : 2;
        for (const p of stones) literal[p] = attacker;
        const expected = [];
        for (let p = 0; p < 225; p++) if (!literal[p]) {
          literal[p] = attacker;
          if (winningSquares(literal, attacker).length) expected.push(p);
          literal[p] = 0;
        }
        assert.deepEqual(squares(forcing), expected);
        const candidates = generateCandidateMoves(b,w,color,lines,null,forcing);
        for (const p of expected) assert.ok(candidates.some(move => move.position === p));
        cases++;
      }
    }
  }
  assert.equal(cases, 80);
});

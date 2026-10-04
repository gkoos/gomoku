import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Run the actual self-contained worker with only its browser messaging stubbed.
const messages = [];
let listener;
const ai = vm.createContext({
  self: {
    addEventListener(type, callback) {
      if (type === 'message') listener = callback;
    },
    postMessage(message) { messages.push(message); },
  },
  performance,
  console,
});
vm.runInContext(fs.readFileSync(new URL('../src/ai-worker.js', import.meta.url), 'utf8'), ai);

function bitboard(stones = []) {
  const result = Array(8).fill(0);
  for (const [row, col] of stones) {
    const position = row * 15 + col;
    result[position >>> 5] |= 1 << (position % 32);
  }
  return result;
}
const empty = bitboard();
function search(black, white, depth, maximizing = true, history = [], computer = 'black') {
  return ai.minimaxAlphaBeta(
    black, white, depth, -Infinity, Infinity, maximizing,
    computer, computer === 'black' ? 'white' : 'black', history,
  );
}
const sparseWin = bitboard([[0, 0], [0, 1], [0, 2], [0, 3], [6, 6], [7, 7], [8, 8]]);
const denseOpponent = bitboard([[6, 7], [6, 8], [7, 6], [7, 8], [8, 6], [8, 7], [12, 12]]);

test('candidate generation preserves sparse wins and blocks before pruning', () => {
  const wins = ai.generateCandidateMoves(sparseWin, denseOpponent, 'black');
  const blocks = ai.generateCandidateMoves(sparseWin, denseOpponent, 'white');
  assert.equal(wins[0].position, 4);
  assert.equal(wins[0].tactical, 2);
  assert.equal(blocks[0].position, 4);
  assert.equal(blocks[0].tactical, 1);
});

test('minimax includes winning moves after both branching limits', () => {
  for (const computer of ['black', 'white']) {
    const [black, white] = computer === 'black' ?
      [sparseWin, denseOpponent] : [denseOpponent, sparseWin];
    for (const depth of [1, 2]) {
      const result = search(black, white, depth, true, [], computer);
      assert.equal(result.move.position, 4);
      assert.equal(result.score, 999999);
    }
  }
});

test('minimizing nodes include the opponent winning reply', () => {
  const result = search(denseOpponent, sparseWin, 1, false);
  assert.equal(result.move.position, 4);
  assert.equal(result.score, -999999);
});

test('search cannot prune a mandatory block in a sparse area', () => {
  for (const depth of [1, 2]) {
    assert.equal(search(denseOpponent, sparseWin, depth).move.position, 4);
  }
});

test('wins and losses have the same terminal score at and before the horizon', () => {
  const won = bitboard([[7, 5], [7, 6], [7, 7], [7, 8], [7, 9]]);
  for (const depth of [0, 1, 2]) {
    assert.equal(search(won, empty, depth, false, [{ row: 7, col: 9 }]).score, 999999);
    assert.equal(search(empty, won, depth, true, [{ row: 7, col: 9 }]).score, -999999);
  }
});

test('heuristic totals stay strictly below terminal scores', () => {
  const manyFours = bitboard([2, 5, 8, 11].flatMap(row =>
    [5, 6, 7, 8].map(col => [row, col])));
  const staticScore = ai.evaluatePosition(manyFours, empty, 'black', 'white');
  assert.ok(staticScore > 0 && staticScore <= 500000);
  const won = bitboard([[7, 5], [7, 6], [7, 7], [7, 8], [7, 9]]);
  assert.ok(search(won, empty, 0, false, [{ row: 7, col: 9 }]).score > staticScore);
});

test('open four detection requires two empty ends', () => {
  const three = bitboard([[7, 5], [7, 6], [7, 7]]);
  const blocked = bitboard([[7, 4]]);
  assert.equal(ai.hasOpen4PatternSimple(three, three, blocked, 7, 8, 0, 1), false);
  assert.equal(ai.hasOpen4PatternSimple(three, three, empty, 7, 8, 0, 1), true);
  const edge = bitboard([[0, 0], [0, 1], [0, 2]]);
  assert.equal(ai.hasOpen4PatternSimple(edge, edge, empty, 0, 3, 0, 1), false);
});

test('every difficulty chooses a true open four ahead of a closed four', async () => {
  const black = bitboard([[2, 2], [2, 3], [2, 4], [10, 5], [10, 6], [10, 7]]);
  const white = bitboard([[2, 1], [0, 0], [0, 2], [0, 4], [14, 0], [14, 2]]);
  for (const difficulty of ['easy', 'medium', 'hard']) {
    const move = await ai.findBestMove(black, white, 'black', 'white', difficulty);
    assert.equal(move.row, 10);
    assert.ok(move.col === 4 || move.col === 8);
  }
});

test('adjacent priorities are upgraded and survive board reflection', () => {
  const stones = [[5, 5], [5, 6], [6, 5]];
  const original = ai.generateCandidateMoves(bitboard(stones), empty);
  assert.equal(original.find(move => move.row === 4 && move.col === 6).priority, 170);
  assert.equal(original.find(move => move.row === 5 && move.col === 7).priority, 172);
  for (const reflect of [
    ([row, col]) => [14 - row, col],
    ([row, col]) => [row, 14 - col],
    ([row, col]) => [14 - row, 14 - col],
  ]) {
    const reflected = ai.generateCandidateMoves(bitboard(stones.map(reflect)), empty);
    const [checkRow, checkCol] = reflect([4, 6]);
    assert.equal(reflected.find(move => move.row === checkRow && move.col === checkCol).priority, 170);
    for (const move of original) {
      const [row, col] = reflect([move.row, move.col]);
      const other = reflected.find(candidate => candidate.row === row && candidate.col === col);
      if (other) assert.equal(other.priority, move.priority);
    }
  }
});

test('both evaluators recognize every broken-four shape in every direction', () => {
  for (const evaluate of [ai.evaluateLineEnhanced, ai.evaluateLinePattern]) {
    for (const [dRow, dCol] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      for (const gap of [1, 2, 3]) {
        const stones = [0, 1, 2, 3, 4].filter(offset => offset !== gap)
          .map(offset => [5 + dRow * offset, 8 + dCol * offset]);
        assert.equal(evaluate(bitboard(stones), empty, 5, 8, dRow, dCol), 10000);
      }
    }
  }
});

test('evaluators distinguish two winning endpoints from a blockable four', () => {
  const four = bitboard([[7, 5], [7, 6], [7, 7], [7, 8]]);
  for (const evaluate of [ai.evaluateLineEnhanced, ai.evaluateLinePattern]) {
    assert.equal(evaluate(four, empty, 7, 6, 0, 1), 20000);
    assert.equal(evaluate(four, bitboard([[7, 4]]), 7, 6, 0, 1), 10000);
  }
});

test('lines with no room for five receive no threat score', () => {
  for (const evaluate of [ai.evaluateLineEnhanced, ai.evaluateLinePattern]) {
    assert.equal(evaluate(
      bitboard([[7, 4], [7, 5], [7, 6]]), bitboard([[7, 3], [7, 8]]), 7, 5, 0, 1,
    ), 0);
    assert.equal(evaluate(
      bitboard([[7, 4], [7, 5], [7, 6], [7, 7]]), bitboard([[7, 3], [7, 8]]), 7, 5, 0, 1,
    ), 0);
    assert.equal(evaluate(
      bitboard([[0, 0], [0, 1], [0, 2]]), bitboard([[0, 4]]), 0, 1, 0, 1,
    ), 0);
  }
});

test('windows handle signed bit 31, slot boundaries, and the final board cell', () => {
  const crossing = bitboard([[2, 0], [2, 1], [2, 3], [2, 4]]);
  const lastRow = bitboard([[14, 10], [14, 11], [14, 12], [14, 13]]);
  assert.ok(ai.checkImmediateThreat(crossing, empty, 'black').some(move => move.position === 32));
  assert.ok(ai.checkImmediateThreat(lastRow, empty, 'black').some(move => move.position === 224));
  for (const evaluate of [ai.evaluateLineEnhanced, ai.evaluateLinePattern]) {
    assert.equal(evaluate(crossing, empty, 2, 1, 0, 1), 10000);
    assert.equal(evaluate(lastRow, bitboard([[14, 9]]), 14, 12, 0, 1), 10000);
  }
});

test('worker protocol returns a winning move without mutating input bitboards', async () => {
  const black = bitboard([[7, 5], [7, 6], [7, 7], [7, 8]]);
  const white = bitboard([[7, 4]]);
  const before = [black.slice(), white.slice()];
  messages.length = 0;
  await listener({ data: {
    type: 'FIND_BEST_MOVE',
    data: { blackBitboard: black, whiteBitboard: white, computerPlayer: 'black', humanPlayer: 'white', difficulty: 'hard' },
  } });
  const result = messages.find(message => message.type === 'BEST_MOVE_FOUND');
  assert.equal(result.move.row, 7);
  assert.equal(result.move.col, 9);
  ai.generateCandidateMoves(black, white);
  assert.deepEqual([black, white], before);
});

test('all difficulties neutralize crossing open-four threats with the shared defense', async () => {
  const attack = [[10, 5], [10, 6], [10, 7], [7, 8], [8, 8], [9, 8]];
  const defense = [[0, 0], [0, 2], [0, 4], [14, 0], [14, 2], [14, 4]];
  for (const computer of ['black', 'white']) {
    const [black, white] = computer === 'black' ?
      [bitboard(defense), bitboard(attack)] : [bitboard(attack), bitboard(defense)];
    const human = computer === 'black' ? 'white' : 'black';
    for (const difficulty of ['easy', 'medium', 'hard']) {
      const move = await ai.findBestMove(black, white, computer, human, difficulty);
      assert.equal(move.row, 10);
      assert.equal(move.col, 8);
      const afterBlack = black.slice(), afterWhite = white.slice();
      const position = move.row * 15 + move.col;
      (computer === 'black' ? afterBlack : afterWhite)[position >>> 5] |= 1 << (position % 32);
      assert.equal(ai.checkOpen4Threats(afterBlack, afterWhite, human).length, 0);
      assert.deepEqual(black, computer === 'black' ? bitboard(defense) : bitboard(attack));
      assert.deepEqual(white, computer === 'black' ? bitboard(attack) : bitboard(defense));
    }
  }
});

test('shared open-four defenses remain correct after reflection and rotation', async () => {
  const attack = [[10, 5], [10, 6], [10, 7], [7, 8], [8, 8], [9, 8]];
  const defense = [[0, 0], [0, 2], [0, 4], [14, 0], [14, 2], [14, 4]];
  for (const transform of [
    ([row, col]) => [14 - row, col],
    ([row, col]) => [col, 14 - row],
  ]) {
    const move = await ai.findBestMove(bitboard(defense.map(transform)), bitboard(attack.map(transform)),
      'black', 'white', 'easy');
    const [row, col] = transform([10, 8]);
    assert.equal(move.row, row);
    assert.equal(move.col, col);
  }
});

test('multiple windows alone do not make an open three', () => {
  for (const [dRow, dCol] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const at = offset => [7 + dRow * offset, 7 + dCol * offset];
    const player = bitboard([-3, -2, 0, 2, 3].map(at));
    const opponent = bitboard([-4, 4].map(at));
    assert.equal(ai.analyzeLinePattern(player, opponent, 7, 7, dRow, dCol).openThree, false);
    assert.equal(ai.evaluateLineEnhanced(player, opponent, 7, 7, dRow, dCol), 500);
    assert.equal(ai.evaluateLinePattern(player, opponent, 7, 7, dRow, dCol), 100);
  }
});

test('contiguous and broken threes retain open strength when they can create an open four', () => {
  for (const offsets of [[-1, 0, 1], [-1, 0, 2], [-2, 0, 1]]) {
    const player = bitboard(offsets.map(offset => [7, 7 + offset]));
    assert.equal(ai.analyzeLinePattern(player, empty, 7, 7, 0, 1).openThree, true);
    assert.equal(ai.evaluateLineEnhanced(player, empty, 7, 7, 0, 1), 2000);
    assert.equal(ai.evaluateLinePattern(player, empty, 7, 7, 0, 1), 1000);
  }
  const cramped = bitboard([[7, 1], [7, 2], [7, 3]]);
  assert.equal(ai.analyzeLinePattern(cramped, bitboard([[7, 5]]), 7, 2, 0, 1).openThree, false);
});

test('terminal wins at the root produce a terminal score and no move', async () => {
  const won = bitboard([[7, 4], [7, 5], [7, 6], [7, 7], [7, 8], [7, 9]]);
  for (const computer of ['black', 'white']) {
    const [black, white] = computer === 'black' ? [won, empty] : [empty, won];
    for (const difficulty of ['easy', 'medium', 'hard']) {
      assert.equal(await ai.findBestMove(black, white, computer, computer === 'black' ? 'white' : 'black', difficulty), null);
      assert.equal(ai.findBestMoveAdaptive(black, white, computer, computer === 'black' ? 'white' : 'black', difficulty), null);
    }
    const result = search(black, white, 1, true, [], computer);
    assert.equal(result.score, 1000000);
    assert.equal(result.move, null);
    assert.equal(search(black, white, 0, true, [], computer).score, 1000000);
    assert.equal(search(black, white, 1, true, [], computer === 'black' ? 'white' : 'black').score, -1000000);
  }
});

test('full-board draws return no move at every entry point', async () => {
  const black = [], white = [];
  for (let row = 0; row < 15; row++) for (let col = 0; col < 15; col++) {
    ((Math.floor(row / 2) + col) % 2 ? white : black).push([row, col]);
  }
  const b = bitboard(black), w = bitboard(white);
  assert.equal(ai.getBitboardResult(b, w).draw, true);
  for (const difficulty of ['easy', 'medium', 'hard']) {
    assert.equal(await ai.findBestMove(b, w, 'black', 'white', difficulty), null);
    assert.equal(ai.findBestMoveAdaptive(b, w, 'black', 'white', difficulty), null);
  }
  assert.equal(ai.findBestMoveDeepSearch(b, w, 'black', 'white', null, 1), null);
  assert.equal(ai.findLegalFallback(b, w), null);
  for (const depth of [0, 1]) {
    const result = search(b, w, depth);
    assert.equal(result.score, 0);
    assert.equal(result.move, null);
  }
});

test('worker echoes request IDs on progress and results', async () => {
  messages.length = 0;
  await listener({ data: {
    type: 'FIND_BEST_MOVE', requestId: 42,
    data: { blackBitboard: empty, whiteBitboard: empty, computerPlayer: 'black', humanPlayer: 'white', difficulty: 'easy' },
  } });
  assert.ok(messages.some(message => message.type === 'PROGRESS_UPDATE'));
  assert.ok(messages.some(message => message.type === 'BEST_MOVE_FOUND'));
  assert.ok(messages.every(message => message.requestId === 42));
});

test('worker errors return a legal fallback instead of an occupied center', async () => {
  const original = ai.findBestMove;
  const originalConsole = ai.console;
  ai.console = { error() {} };
  ai.findBestMove = async () => { throw new Error('simulated search failure'); };
  messages.length = 0;
  const center = bitboard([[7, 7]]);
  try {
    await listener({ data: {
      type: 'FIND_BEST_MOVE', requestId: 43,
      data: { blackBitboard: center, whiteBitboard: empty, computerPlayer: 'white', humanPlayer: 'black', difficulty: 'easy' },
    } });
    const result = messages.find(message => message.type === 'BEST_MOVE_FOUND');
    assert.equal(result.requestId, 43);
    assert.ok(result.move);
    assert.ok(result.move.row !== 7 || result.move.col !== 7);
  } finally {
    ai.findBestMove = original;
    ai.console = originalConsole;
  }
});

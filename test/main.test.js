import { createGameController } from '../src/game/controller.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { board2Bitboards } from '../src/bitboards.js';
import { getBoardResult, getWinningLine } from '../src/rules.js';

function harness(options = {}) {
  const elements = new Map(),
    cells = new Map(),
    timers = new Map(),
    workers = [],
    alerts = [];
  let timerId = 0;
  function element(id) {
    const classes = new Set();
    return {
      style: {},
      dataset: {},
      listeners: new Map(),
      children: [],
      classList: {
        add(...names) {
          names.forEach((name) => classes.add(name));
        },
        remove(...names) {
          names.forEach((name) => classes.delete(name));
        },
        contains(name) {
          return classes.has(name);
        },
      },
      set className(value) {
        classes.clear();
        value.split(' ').forEach((name) => classes.add(name));
      },
      set innerHTML(value) {
        this.html = value;
        if (id === 'game-board') {
          cells.clear();
          this.children = [];
        }
      },
      get innerHTML() {
        return this.html || '';
      },
      appendChild(child) {
        this.children.push(child);
        cells.set(child.dataset.row + ',' + child.dataset.col, child);
      },
      addEventListener(name, callback) {
        this.listeners.set(name, callback);
      },
    };
  }
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element(id));
      return elements.get(id);
    },
    createElement() {
      return element();
    },
    querySelector(selector) {
      if (selector === '#app') return this.getElementById('app');
      if (selector === '.last-move')
        return (
          [...cells.values()].find((cell) =>
            cell.classList.contains('last-move'),
          ) || null
        );
      const match = selector.match(/data-row="(\d+)".*data-col="(\d+)"/);
      if (match) return cells.get(match[1] + ',' + match[2]) || null;
      throw new Error('Unexpected selector: ' + selector);
    },
  };
  class Worker {
    constructor() {
      if (options.failConstruction)
        throw new Error('simulated constructor failure');
      this.sent = [];
      this.terminated = false;
      workers.push(this);
    }
    postMessage(message) {
      if (options.failPost && message.type === 'FIND_BEST_MOVE')
        throw new Error('simulated post failure');
      this.sent.push(message);
    }
    terminate() {
      this.terminated = true;
    }
    reply(data) {
      this.onmessage({ data });
    }
  }
  const controller = createGameController({
    document,
    createWorker: () => new Worker(),
    alert: (message) => alerts.push(message),
    reportError() {},
    setTimeout(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  });
  controller.initGame();
  const Setup = controller.Setup;
  const run = (commands) => {
    const color = commands.match(/computerPlayer = '([^']+)'/);
    if (color)
      controller.setHumanPlayer(color[1] === 'black' ? 'white' : 'black');
    for (const match of commands.matchAll(/(\w+)\(([^)]*)\)/g)) {
      const args = match[2]
        ? match[2]
            .split(',')
            .map((value) => (value.trim() === 'true' ? true : Number(value)))
        : [];
      controller[match[1]](...args);
    }
  };
  const state = () => controller.getState();
  const flush = (delay) => {
    for (const [id, timer] of [...timers])
      if (timer.delay === delay && timers.has(id)) {
        timers.delete(id);
        timer.callback();
      }
  };
  const requests = (worker) =>
    worker.sent.filter((message) => message.type === 'FIND_BEST_MOVE');
  const start = (computer = 'white') => {
    run(
      "computerPlayer = '" +
        computer +
        "'; humanPlayer = '" +
        (computer === 'black' ? 'white' : 'black') +
        "'; startGame();",
    );
    if (computer === 'black') flush(500);
    else run('makeMove(7, 7)');
    return workers.at(-1);
  };
  const setup = (board, computer = 'black', next = 'black') => {
    run('enterSetupMode()');
    const setupBoard = Setup.getSetupState().board;
    for (let row = 0; row < 15; row++)
      for (let col = 0; col < 15; col++) setupBoard[row][col] = board[row][col];
    Setup.setSetupComputerColor(computer);
    Setup.setSetupNextMove(next);
    run('startGameFromSetup()');
  };
  return {
    run,
    state,
    flush,
    timers,
    workers,
    alerts,
    Setup,
    elements,
    cells,
    requests,
    start,
    setup,
  };
}
const stoneCount = (state) => state.board.flat().filter(Boolean).length;
const emptyBoard = () => Array.from({ length: 15 }, () => Array(15).fill(null));

test('a delayed reply cannot place a computer stone after reset', () => {
  const h = harness(),
    worker = h.start('black'),
    request = h.requests(worker).at(-1);
  worker.reply({
    type: 'BEST_MOVE_FOUND',
    requestId: request.requestId,
    move: { row: 7, col: 7 },
  });
  const staleTimer = [...h.timers.values()].find(
    (timer) => timer.delay === 150,
  );
  h.run('initGame()');
  assert.ok(worker.terminated);
  assert.equal(h.timers.size, 0);
  staleTimer.callback();
  assert.equal(stoneCount(h.state()), 0);
  assert.equal(h.state().gameInProgress, false);
  h.run('makeMove(7, 7, true)');
  assert.equal(stoneCount(h.state()), 0);
});

test('an old worker reply and timer cannot modify a new game', () => {
  const h = harness(),
    oldWorker = h.start('black'),
    oldRequest = h.requests(oldWorker).at(-1);
  oldWorker.reply({
    type: 'BEST_MOVE_FOUND',
    requestId: oldRequest.requestId,
    move: { row: 0, col: 0 },
  });
  const staleTimer = [...h.timers.values()].find(
    (timer) => timer.delay === 150,
  );
  h.run('initGame()');
  const worker = h.start('black'),
    request = h.requests(worker).at(-1);
  assert.notEqual(request.requestId, oldRequest.requestId);
  oldWorker.reply({
    type: 'BEST_MOVE_FOUND',
    requestId: oldRequest.requestId,
    move: { row: 0, col: 0 },
  });
  worker.reply({
    type: 'BEST_MOVE_FOUND',
    requestId: oldRequest.requestId,
    move: { row: 0, col: 0 },
  });
  worker.reply({
    type: 'BEST_MOVE_FOUND',
    requestId: request.requestId,
    move: { row: 7, col: 7 },
  });
  staleTimer.callback();
  h.flush(150);
  assert.equal(stoneCount(h.state()), 1);
  assert.equal(h.state().board[7][7], 'black');
  assert.equal(h.state().board[0][0], null);
});

test('an opening timer from another game cannot enqueue an extra request', () => {
  const h = harness();
  h.run("computerPlayer = 'black'; humanPlayer = 'white'; startGame()");
  const staleTimer = [...h.timers.values()].find(
    (timer) => timer.delay === 500,
  );
  h.run('initGame()');
  const worker = h.start('black');
  staleTimer.callback();
  h.run('makeComputerMove()');
  assert.equal(h.requests(worker).length, 1);
});

test('duplicate result messages apply one move', () => {
  const h = harness(),
    worker = h.start('white'),
    request = h.requests(worker).at(-1);
  const result = {
    type: 'BEST_MOVE_FOUND',
    requestId: request.requestId,
    move: { row: 6, col: 6 },
  };
  worker.reply(result);
  worker.reply(result);
  h.flush(150);
  worker.reply(result);
  h.flush(150);
  assert.equal(stoneCount(h.state()), 2);
  assert.equal(h.state().currentPlayer, 'black');
});

test('failed worker construction falls back for either computer color', () => {
  for (const computer of ['black', 'white']) {
    const h = harness({ failConstruction: true });
    h.run(
      "computerPlayer = '" +
        computer +
        "'; humanPlayer = '" +
        (computer === 'black' ? 'white' : 'black') +
        "'; startGame()",
    );
    if (computer === 'black') h.flush(500);
    else h.run('makeMove(7, 7)');
    assert.equal(stoneCount(h.state()), computer === 'black' ? 1 : 2);
    assert.equal(
      h.state().currentPlayer,
      computer === 'black' ? 'white' : 'black',
    );
    assert.equal(h.state().activeAIRequest, null);
  }
});

test('postMessage failure retires the worker and makes one fallback move', () => {
  const h = harness({ failPost: true }),
    worker = h.start('white');
  assert.ok(worker.terminated);
  assert.equal(stoneCount(h.state()), 2);
  assert.equal(h.state().currentPlayer, 'black');
  assert.equal(h.state().activeAIRequest, null);
});

test('runtime and message errors retire the worker without duplicate fallback moves', () => {
  for (const event of ['onerror', 'onmessageerror']) {
    const h = harness(),
      worker = h.start('white');
    worker[event](new Error('simulated runtime error'));
    worker[event](new Error('duplicate runtime error'));
    assert.ok(worker.terminated);
    assert.equal(stoneCount(h.state()), 2);
    assert.equal(h.state().currentPlayer, 'black');
    assert.equal(h.state().activeAIRequest, null);
  }
});

test('malformed worker coordinates fall back without throwing', () => {
  const h = harness(),
    worker = h.start('white'),
    request = h.requests(worker).at(-1);
  worker.reply({
    type: 'BEST_MOVE_FOUND',
    requestId: request.requestId,
    move: { row: 999, col: -1 },
  });
  h.flush(150);
  assert.equal(stoneCount(h.state()), 2);
  assert.equal(h.state().currentPlayer, 'black');
});

test('full-board setup finishes as a draw without requesting an AI move', () => {
  const h = harness();
  const board = Array.from({ length: 15 }, (_, row) =>
    Array.from({ length: 15 }, (_, col) =>
      (Math.floor(row / 2) + col) % 2 ? 'white' : 'black',
    ),
  );
  h.setup(board);
  assert.equal(h.state().gameOver, true);
  assert.equal(h.elements.get('game-status').innerHTML, 'Game Draw!');
  assert.ok(h.workers.every((worker) => h.requests(worker).length === 0));
  h.run('makeComputerMove()');
  assert.equal(stoneCount(h.state()), 225);
});

test('already-won setup displays the winner and prevents further moves', () => {
  for (const winner of ['black', 'white']) {
    const h = harness(),
      board = emptyBoard();
    for (let col = 0; col < 6; col++) board[0][col] = winner;
    h.setup(board, 'black', 'white');
    assert.equal(h.state().gameOver, true);
    assert.equal(
      h.elements.get('game-status').innerHTML,
      winner === 'black' ? 'Computer Wins!' : 'You Win!',
    );
    assert.equal(
      [...h.cells.values()].filter((cell) =>
        cell.classList.contains('winning-stone'),
      ).length,
      5,
    );
    h.run('makeMove(7, 7); makeComputerMove()');
    assert.equal(stoneCount(h.state()), 6);
    assert.ok(h.workers.every((worker) => h.requests(worker).length === 0));
  }
});

test('a setup with both colors already winning is rejected', () => {
  const h = harness(),
    board = emptyBoard();
  for (let col = 0; col < 5; col++) {
    board[0][col] = 'black';
    board[2][col] = 'white';
  }
  h.setup(board);
  assert.equal(h.alerts.length, 1);
  assert.equal(h.Setup.isSetupMode(), true);
  assert.equal(h.state().gameInProgress, false);
});

test('setup cannot interrupt an active game and cancellation restores initial state', () => {
  const h = harness();
  h.run('startGame(); enterSetupMode()');
  assert.equal(h.elements.get('setup-btn').style.visibility, 'hidden');
  assert.equal(h.Setup.isSetupMode(), false);
  h.run('initGame(); enterSetupMode(); exitSetupMode()');
  assert.equal(h.Setup.isSetupMode(), false);
  assert.equal(h.state().gameInProgress, false);
  assert.equal(h.state().currentPlayer, 'black');
  assert.equal(stoneCount(h.state()), 0);
});

test('shared rules identify wins in every direction and reject ambiguous winners', () => {
  for (const [dRow, dCol] of [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ]) {
    const board = emptyBoard();
    for (let step = 0; step < 5; step++)
      board[4 + dRow * step][8 + dCol * step] = 'white';
    assert.equal(getBoardResult(board).winner, 'white');
    assert.equal(getWinningLine(board, 4 + dRow * 2, 8 + dCol * 2).length, 5);
  }
});

test('controllers have independent setup state and explicit phases', () => {
  const first = harness(),
    second = harness();
  assert.equal(first.state().phase, 'idle');
  first.run('enterSetupMode()');
  assert.equal(first.state().phase, 'setup');
  assert.equal(second.state().phase, 'idle');
  first.Setup.toggleSetupCell(2, 3);
  assert.equal(second.Setup.isSetupMode(), false);
  second.run('enterSetupMode()');
  assert.equal(second.Setup.getSetupState().board[2][3], null);
  first.run('exitSetupMode(); startGame()');
  assert.equal(first.state().phase, 'playing');
  const snapshot = first.state();
  snapshot.board[1][1] = 'black';
  assert.equal(first.state().board[1][1], null);
});

test('Move now uses the deepest completed result and ignores obsolete workers', () => {
  const h = harness(),
    oldWorker = h.start('black'),
    request = h.requests(oldWorker).at(-1);
  const button = h.elements.get('move-now-btn');
  assert.equal(button.disabled, false);
  oldWorker.reply({
    type: 'SEARCH_ITERATION',
    requestId: request.requestId,
    depth: 2,
    move: { row: 5, col: 5 },
  });
  oldWorker.reply({
    type: 'SEARCH_ITERATION',
    requestId: request.requestId,
    depth: 1,
    move: { row: 4, col: 4 },
  });
  oldWorker.reply({
    type: 'SEARCH_ITERATION',
    requestId: request.requestId,
    depth: 3,
    move: { row: -1, col: 5 },
  });
  assert.equal(h.state().completedDepth, 2);
  button.listeners.get('click')();
  assert.ok(oldWorker.terminated);
  assert.equal(h.state().board[5][5], 'black');
  assert.equal(h.state().activeAIRequest, null);
  assert.equal(button.disabled, true);
  button.listeners.get('click')();
  assert.equal(stoneCount(h.state()), 1);
  h.run('makeMove(6,6)');
  const nextWorker = h.workers.at(-1),
    nextRequest = h.requests(nextWorker).at(-1);
  assert.notEqual(nextWorker, oldWorker);
  assert.notEqual(nextRequest.requestId, request.requestId);
  oldWorker.reply({
    type: 'BEST_MOVE_FOUND',
    requestId: request.requestId,
    move: { row: 3, col: 3 },
  });
  oldWorker.reply({
    type: 'SEARCH_ITERATION',
    requestId: request.requestId,
    depth: 8,
    move: { row: 3, col: 3 },
  });
  h.flush(150);
  assert.equal(stoneCount(h.state()), 2);
  nextWorker.reply({
    type: 'BEST_MOVE_FOUND',
    requestId: nextRequest.requestId,
    move: { row: 8, col: 8 },
  });
  h.flush(150);
  assert.equal(stoneCount(h.state()), 3);
  assert.equal(button.disabled, true);
});
test('Move now can act before depth one completes', () => {
  const h = harness(),
    worker = h.start('black');
  h.elements.get('move-now-btn').listeners.get('click')();
  assert.ok(worker.terminated);
  assert.equal(stoneCount(h.state()), 1);
  assert.equal(h.state().board[7][7], 'black');
});
test('Move now cancels a delayed final result without applying it twice', () => {
  const h = harness(),
    worker = h.start('black'),
    request = h.requests(worker).at(-1);
  worker.reply({
    type: 'BEST_MOVE_FOUND',
    requestId: request.requestId,
    move: { row: 4, col: 4 },
  });
  const oldTimer = [...h.timers.values()].find((t) => t.delay === 150);
  h.elements.get('move-now-btn').listeners.get('click')();
  oldTimer.callback();
  assert.equal(h.timers.size, 0);
  assert.equal(stoneCount(h.state()), 1);
  assert.equal(h.state().board[4][4], 'black');
});
test('reset clears completed results and disables Move now', () => {
  const h = harness(),
    worker = h.start('black'),
    request = h.requests(worker).at(-1);
  worker.reply({
    type: 'SEARCH_ITERATION',
    requestId: request.requestId,
    depth: 3,
    move: { row: 4, col: 4 },
  });
  h.run('initGame()');
  assert.equal(h.elements.get('move-now-btn').disabled, true);
  assert.equal(h.state().completedDepth, 0);
  h.elements.get('move-now-btn').listeners.get('click')();
  assert.equal(stoneCount(h.state()), 0);
  h.start('black');
  h.elements.get('move-now-btn').listeners.get('click')();
  assert.equal(h.state().board[7][7], 'black');
  assert.equal(h.state().board[4][4], null);
});

test('Expert selection reaches the worker and remains locked during play', () => {
  const h = harness();
  assert.match(h.elements.get('app').innerHTML, /value="expert"/);
  const change = h.elements.get('ai-difficulty').listeners.get('change');
  change({ target: { value: 'expert' } });
  assert.equal(h.state().aiDifficulty, 'expert');
  const worker = h.start();
  assert.equal(h.requests(worker).at(-1).data.difficulty, 'expert');
  change({ target: { value: 'easy' } });
  assert.equal(h.state().aiDifficulty, 'expert');
});

import { performance } from 'node:perf_hooks';

export const WEIGHT_NAMES = ['five', 'openFour', 'closedFour', 'openThree', 'closedThree', 'openTwo', 'closedTwo', 'singleWindow'];
export const DEFAULT_WEIGHTS = [100000, 20000, 10000, 1000, 100, 100, 10, 1];

export function parseWeights(value = {}) {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Weights must be a JSON object');
  for (const key of Object.keys(value)) if (!WEIGHT_NAMES.includes(key)) throw new Error(`Unknown weight: ${key}`);
  return WEIGHT_NAMES.map((key, i) => {
    const weight = Object.hasOwn(value, key) ? value[key] : DEFAULT_WEIGHTS[i];
    if (!Number.isInteger(weight) || weight < 0 || weight > 100000) throw new Error(`Invalid weight: ${key}`);
    return weight;
  });
}

export function winnerAfter(board, position) {
  const color = board[position];
  if (!color) return null;
  const row = Math.floor(position / 15), col = position % 15;
  for (const [dr, dc] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    let count = 1;
    for (const sign of [-1, 1]) {
      for (let step = 1; step < 15; step++) {
        const r = row + dr * step * sign, c = col + dc * step * sign;
        if (r < 0 || r >= 15 || c < 0 || c >= 15 || board[r * 15 + c] !== color) break;
        count++;
      }
    }
    if (count >= 5) return color;
  }
  return null;
}

export function replay(moves) {
  const board = new Uint8Array(225);
  let winner = null;
  moves.forEach((p, ply) => {
    if (winner || !Number.isInteger(p) || p < 0 || p >= 225 || board[p]) throw new Error(`Illegal move at ply ${ply + 1}: ${p}`);
    board[p] = ply % 2 ? 2 : 1;
    winner = winnerAfter(board, p);
  });
  return { board, winner, terminal: Boolean(winner) || moves.length === 225 };
}

// Four legal opening plies; vary location and neighbouring choices, not search.
export function opening(seed, pair) {
  let state = (seed ^ Math.imul(pair + 1, 0x9e3779b9)) >>> 0;
  const random = (n) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % n;
  };
  const moves = [(4 + random(7)) * 15 + 4 + random(7)];
  while (moves.length < 4) {
    const candidates = new Set();
    for (const p of moves) {
      const r = Math.floor(p / 15), c = p % 15;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const row = r + dr, col = c + dc, next = row * 15 + col;
        if (row >= 0 && row < 15 && col >= 0 && col < 15 && !moves.includes(next)) candidates.add(next);
      }
    }
    moves.push([...candidates][random(candidates.size)]);
  }
  return moves;
}

export function chooseMove(engine, board, black, depth, weights) {
  const b = new Uint32Array(8), w = new Uint32Array(8);
  board.forEach((color, p) => { if (color) (color === 1 ? b : w)[p >>> 5] |= 1 << (p & 31); });
  const level = depth <= 6 ? 1 : depth <= 8 ? 2 : 3;
  const start = performance.now();
  const search = typeof engine.MoveEngine.with_weights === 'function'
    ? engine.MoveEngine.with_weights(b, w, black, level, 4, 32768, Int32Array.from(weights))
    : new engine.MoveEngine(b, w, black, level, 4, 32768);
  try {
    let position = search.root_move(), completedDepth = 0, score = null, nodes = 0, cacheHits = 0, pv = [];
    if (position === -2) {
      for (;;) {
        const iteration = search.next_depth();
        if (!iteration.length) break;
        completedDepth = iteration[0];
        score = iteration[1];
        nodes += iteration[2];
        cacheHits += iteration[3];
        pv = Array.from(iteration.slice(7, 7 + iteration[6]));
        position = pv[0];
        if (completedDepth >= depth) break;
      }
    }
    if (!Number.isInteger(position) || position < 0 || position >= 225 || board[position]) throw new Error(`Engine returned illegal move: ${position}`);
    return { position, depth: completedDepth, score, nodes, cacheHits, pv, milliseconds: performance.now() - start };
  } finally { search.free(); }
}

export function playGame(engines, config, id) {
  const initial = opening(config.seed, Math.floor(id / 2));
  const moves = [...initial], { board } = replay(moves);
  const blackEngine = id % 2 === 0 ? 'a' : 'b', whiteEngine = blackEngine === 'a' ? 'b' : 'a';
  const turns = [];
  let winner = null;
  while (moves.length < 225 && !winner) {
    const black = moves.length % 2 === 0, player = black ? blackEngine : whiteEngine;
    const turn = chooseMove(engines[player], board, black, config.depth, config[player].weights);
    board[turn.position] = black ? 1 : 2;
    moves.push(turn.position);
    turns.push({ player, ...turn });
    winner = winnerAfter(board, turn.position);
  }
  return { type: 'game', id, opening: initial, blackEngine, whiteEngine, moves, turns,
    winner: winner === 1 ? 'black' : winner === 2 ? 'white' : null,
    winningEngine: winner === 1 ? blackEngine : winner === 2 ? whiteEngine : null };
}

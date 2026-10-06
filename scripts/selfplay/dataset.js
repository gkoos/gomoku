import { createHash } from 'node:crypto';
import { replay } from './core.js';

export const DATASET_VERSION = 1;
const hash = (text) => createHash('sha256').update(text).digest('hex');
const transforms = Array.from({ length: 8 }, (_, t) => Array.from({ length: 225 }, (_, p) => {
  let r = Math.floor(p / 15), c = p % 15;
  if (t >= 4) c = 14 - c;
  for (let i = 0; i < t % 4; i++) [r, c] = [c, 14 - r];
  return r * 15 + c;
}));

/** Maintain all orientations; compare words before allocating one canonical key. */
export class CanonicalBoard {
  constructor() { this.boards = transforms.map(() => [new Uint32Array(8), new Uint32Array(8)]); }
  place(position, black) {
    for (let t = 0; t < 8; t++) {
      const p = transforms[t][position];
      this.boards[t][black ? 0 : 1][p >>> 5] |= 1 << (p & 31);
    }
  }
  key(sideToMove) {
    let best = 0;
    for (let t = 1; t < 8; t++) {
      compare: for (let color = 0; color < 2; color++) for (let word = 0; word < 8; word++) {
        const a = this.boards[t][color][word], b = this.boards[best][color][word];
        if (a !== b) { if (a < b) best = t; break compare; }
      }
    }
    return (sideToMove === 'black' ? 'b' : 'w') + this.boards[best].flatMap((board) =>
      Array.from(board, (word) => word.toString(16).padStart(8, '0'))).join('');
  }
}

export function decodePosition(key) {
  const black = [], white = [];
  for (let color = 0; color < 2; color++) for (let word = 0; word < 8; word++) {
    let mask = Number.parseInt(key.slice(1 + color * 64 + word * 8, 9 + color * 64 + word * 8), 16) >>> 0;
    while (mask) {
      const bit = 31 - Math.clz32(mask & -mask);
      (color ? white : black).push(word * 32 + bit);
      mask = (mask & (mask - 1)) >>> 0;
    }
  }
  return { black, white, sideToMove: key[0] === 'b' ? 'black' : 'white' };
}

export function validateGame(game, config) {
  if (game.type !== 'game' || !Number.isInteger(game.id) || game.id < 0 || !Array.isArray(game.moves) ||
      !Array.isArray(game.opening) || !game.opening.length || !Array.isArray(game.turns)) throw new Error('Invalid game record');
  const state = replay(game.moves);
  const winner = state.winner === 1 ? 'black' : state.winner === 2 ? 'white' : null;
  const black = game.id % 2 ? 'b' : 'a', white = black === 'a' ? 'b' : 'a';
  if (!state.terminal || winner !== game.winner || game.blackEngine !== black || game.whiteEngine !== white ||
      game.winningEngine !== (winner === 'black' ? black : winner === 'white' ? white : null) ||
      game.opening.length >= game.moves.length || game.opening.some((p, i) => p !== game.moves[i]) ||
      game.turns.length !== game.moves.length - game.opening.length) throw new Error('Game result, opening, or colour assignment is inconsistent');
  for (let i = 0; i < game.turns.length; i++) {
    const turn = game.turns[i], ply = game.opening.length + i;
    const player = ply % 2 ? white : black;
    if (turn.player !== player || turn.position !== game.moves[ply] || !Number.isInteger(turn.depth) ||
        turn.depth < 0 || turn.depth > config.depth ||
        (turn.depth === 0 ? turn.score !== null : !Number.isInteger(turn.score) || Math.abs(turn.score) > 1000000)) {
      throw new Error(`Invalid search label at ply ${ply}`);
    }
  }
}

class Groups {
  constructor() { this.parent = []; this.minimum = []; }
  add(key) { const i = this.parent.length; this.parent.push(i); this.minimum.push(key); return i; }
  root(i) {
    let r = i;
    while (r !== this.parent[r]) r = this.parent[r];
    while (i !== r) { const next = this.parent[i]; this.parent[i] = r; i = next; }
    return r;
  }
  join(a, b) {
    a = this.root(a); b = this.root(b);
    if (a === b) return;
    const root = Math.min(a, b), child = Math.max(a, b);
    this.parent[child] = root;
    this.minimum[root] = this.minimum[a] < this.minimum[b] ? this.minimum[a] : this.minimum[b];
  }
}

/** Graph every post-opening position, including unsampled and terminal boards.
 * This joins opening pairs and transposing games before deciding the split. */
export function buildDataset(runs, options) {
  const groups = new Groups(), owners = new Map(), samples = new Map();
  let games = 0, observations = 0, missingSearchLabels = 0;
  for (const run of runs) for (const game of run.games) {
    validateGame(game, run.config);
    const board = new CanonicalBoard();
    for (let ply = 0; ply < game.opening.length; ply++) board.place(game.moves[ply], ply % 2 === 0);
    const group = groups.add(board.key(game.opening.length % 2 ? 'white' : 'black'));
    games++;
    for (let ply = game.opening.length; ply <= game.moves.length; ply++) {
      const side = ply % 2 ? 'white' : 'black', key = board.key(side);
      if (owners.has(key)) groups.join(group, owners.get(key)); else owners.set(key, group);
      // Hash sampling avoids an even stride selecting only Black-to-move boards.
      // The same canonical position is selected in every game that reaches it.
      if (ply < game.moves.length && ply >= options.minPly && ply <= options.maxPly &&
          Number.parseInt(hash(`${options.seed}:sample:${key}`).slice(0, 8), 16) % options.stride === 0) {
        const turn = game.turns[ply - game.opening.length];
        if (turn.depth >= options.minDepth) {
          let sample = samples.get(key);
          if (!sample) {
            sample = { key, group, ply, outcomes: { win: 0, draw: 0, loss: 0 }, labels: new Map() };
            samples.set(key, sample);
          }
          sample.outcomes[game.winner === null ? 'draw' : game.winner === side ? 'win' : 'loss']++;
          observations++;
          if (turn.score === null) missingSearchLabels++;
          else {
            const teacher = run.config[turn.player];
            const label = { score: turn.score, depth: turn.depth, engineDigest: teacher.digest, weights: teacher.weights };
            const labelKey = JSON.stringify(label);
            const existing = sample.labels.get(labelKey);
            if (existing) existing.observations++;
            else sample.labels.set(labelKey, { ...label, observations: 1,
              kind: Math.abs(turn.score) >= 1000000 - 225 ? 'mate' : 'evaluation' });
          }
        }
      }
      if (ply < game.moves.length) board.place(game.moves[ply], ply % 2 === 0);
    }
  }
  const rows = [], groupInfo = new Map();
  for (const sample of samples.values()) {
    const group = hash(groups.minimum[groups.root(sample.group)]);
    const bucket = Number.parseInt(hash(`${options.seed}:${group}`).slice(0, 13), 16) / 0x10000000000000;
    const split = bucket < options.validationFraction ? 'validation' : 'train';
    const { win, draw, loss } = sample.outcomes, count = win + draw + loss;
    const labels = [...sample.labels.values()].sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0);
    const row = { id: hash(sample.key), group, ...decodePosition(sample.key), ply: sample.ply,
      outcome: (win - loss) / count, outcomeCounts: sample.outcomes, observations: count, searchLabels: labels };
    rows.push({ split, row });
    const info = groupInfo.get(group) ?? { split, positions: 0 };
    info.positions++; groupInfo.set(group, info);
  }
  rows.sort((a, b) => a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0);
  const splitCounts = { train: 0, validation: 0 };
  const sideCounts = { black: 0, white: 0 };
  for (const { split, row } of rows) { splitCounts[split]++; sideCounts[row.sideToMove]++; }
  return { rows, stats: { games, observations, uniquePositions: rows.length, duplicatesMerged: observations - rows.length,
    missingSearchLabels, groups: groupInfo.size, largestGroupPositions: [...groupInfo.values()].reduce((max, g) => Math.max(max, g.positions), 0), splitCounts, sideCounts } };
}

import { opening, replay } from '../selfplay/core.js';
import { lengthStats } from './lengths.js';

export function openingText(seed, pair) {
  return opening(seed, pair).map(p => `${p % 15 - 7},${Math.floor(p / 15) - 7}`).join(', ') + '\n';
}

// Parse the manager's flat SGF collection, including escaped property values.
export function parseGames(text, initial) {
  const tokens = text.matchAll(/\(|\)|;|([A-Z]+)((?:\[(?:\\[\s\S]|[^\]\\])*\])+)/g);
  const games = [];
  let nodes = null, node = null;
  for (const token of tokens) {
    if (token[0] === '(') {
      if (nodes) throw new Error('SGF variations are unsupported');
      nodes = [];
    } else if (token[0] === ')') {
      if (!nodes?.length) throw new Error('Invalid SGF tree');
      games.push(decodeGame(nodes, initial)); nodes = null; node = null;
    } else if (token[0] === ';') {
      if (!nodes) throw new Error('Node outside SGF tree');
      node = {}; nodes.push(node);
    } else {
      if (!node || Object.hasOwn(node, token[1])) throw new Error('Invalid SGF property');
      node[token[1]] = [...token[2].matchAll(/\[((?:\\[\s\S]|[^\]\\])*)\]/g)]
        .map(m => m[1].replace(/\\([\s\S])/g, '$1'));
    }
  }
  if (nodes) throw new Error('Incomplete SGF tree');
  return games;
}

function decodeGame(nodes, initial) {
  const get = (node, key) => node[key]?.[0];
  const head = nodes[0], black = get(head, 'PB'), white = get(head, 'PW');
  if (get(head, 'SZ') !== '15' || get(head, 'RU') !== '0' ||
      !['Gomoku', 'Rapfi'].includes(black) || !['Gomoku', 'Rapfi'].includes(white) || black === white) {
    throw new Error('Unexpected board, rule, or players');
  }
  const turns = [], moves = [];
  for (const node of nodes.slice(1)) {
    const color = moves.length % 2 ? 'W' : 'B', coord = get(node, color);
    if (!coord || !/^[a-o]{2}$/.test(coord) || node[color === 'B' ? 'W' : 'B']) throw new Error('Invalid SGF move');
    const position = (coord.charCodeAt(1) - 97) * 15 + coord.charCodeAt(0) - 97;
    const comment = get(node, 'C');
    if (moves.length < initial.length) {
      if (position !== initial[moves.length] || comment !== 'opening move') throw new Error('Opening mismatch');
    } else {
      if (!/^\d+ms$/.test(comment)) throw new Error('Missing move timing');
      turns.push({ player: color === 'B' ? black : white, position, milliseconds: Number(comment.slice(0, -2)) });
    }
    moves.push(position);
  }
  if (moves.length < initial.length) throw new Error('Incomplete opening');
  const state = replay(moves), result = get(head, 'RE'), reason = get(head, 'TE');
  const expected = state.winner === 1 ? 'B+1' : state.winner === 2 ? 'W+1' : state.terminal ? '0' : null;
  if (!expected || result !== expected) throw new Error(`Non-board result or unfinished game: ${result} (${reason})`);
  return { black, white, result, reason, moves, turns,
    winningEngine: state.winner === 1 ? black : state.winner === 2 ? white : null };
}

export function validatePair(games) {
  if (games.length !== 2 || games[0].black === games[1].black) throw new Error('Expected two games with swapped colors');
}

export function report(games) {
  const wins = games.filter(g => g.winningEngine === 'Gomoku').length;
  const losses = games.filter(g => g.winningEngine === 'Rapfi').length;
  const draws = games.length - wins - losses;
  const timing = {};
  for (const player of ['Gomoku', 'Rapfi']) {
    const times = games.flatMap(g => g.turns.filter(t => t.player === player).map(t => t.milliseconds)).sort((a, b) => a - b);
    const sum = times.reduce((a, b) => a + b, 0);
    timing[player] = { moves: times.length, totalMilliseconds: sum, meanMilliseconds: times.length ? sum / times.length : null,
      medianMilliseconds: times.length ? times[Math.floor((times.length - 1) * 0.5)] : null,
      p95Milliseconds: times.length ? times[Math.ceil(times.length * 0.95) - 1] : null,
      maxMilliseconds: times.length ? times.at(-1) : null };
  }
  const byColor = Object.fromEntries(['black', 'white'].map(color => {
    const subset = games.filter(g => g[color] === 'Gomoku');
    return [color, { games: subset.length, wins: subset.filter(g => g.winningEngine === 'Gomoku').length,
      draws: subset.filter(g => !g.winningEngine).length, losses: subset.filter(g => g.winningEngine === 'Rapfi').length }];
  }));
  return { games: games.length, wins, draws, losses, score: games.length ? (wins + draws / 2) / games.length : null,
    byColor, timing, lengths: lengthStats(games), lossesForReview: games.filter(g => g.winningEngine === 'Rapfi').map(g => ({ pair: g.pair, color: g.black === 'Gomoku' ? 'black' : 'white', plies: g.moves.length })) };
}

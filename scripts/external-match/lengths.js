export function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return { count: n, mean: n ? sorted.reduce((a, b) => a + b, 0) / n : null,
    median: n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2 : null,
    min: n ? sorted[0] : null, max: n ? sorted.at(-1) : null };
}

function summarize(games) {
  return { games: games.length,
    totalPlies: distribution(games.map(g => g.moves.length)),
    playedPlies: distribution(games.map(g => g.turns.length)),
    gomokuMoves: distribution(games.map(g => g.turns.filter(t => t.player === 'Gomoku').length)) };
}

export function lengthStats(games) {
  const losses = games.filter(g => g.winningEngine === 'Rapfi');
  return { all: summarize(games), wins: summarize(games.filter(g => g.winningEngine === 'Gomoku')),
    draws: summarize(games.filter(g => !g.winningEngine)), losses: summarize(losses),
    lossesByColor: Object.fromEntries(['black', 'white'].map(color => [color, summarize(losses.filter(g => g[color] === 'Gomoku'))])) };
}

export function compareLengths(baseline, current) {
  const key = g => `${g.pair}:${g.index}`;
  const index = games => {
    const map = new Map();
    for (const game of games) {
      if (!Number.isInteger(game.pair) || !Number.isInteger(game.index) || map.has(key(game))) throw new Error('Invalid or duplicate game ID');
      map.set(key(game), game);
    }
    return map;
  };
  const before = index(baseline), after = index(current);
  if (before.size !== after.size) throw new Error('Matches must contain the same games');
  const matchedLosses = [], changedResults = [];
  for (const [id, a] of before) {
    const b = after.get(id);
    const openingPly = a.moves.length - a.turns.length;
    if (!b || a.black !== b.black || a.white !== b.white || openingPly !== b.moves.length - b.turns.length ||
        JSON.stringify(a.moves.slice(0, openingPly)) !== JSON.stringify(b.moves.slice(0, openingPly))) throw new Error(`Opening/color mismatch: ${id}`);
    if (a.winningEngine !== b.winningEngine) changedResults.push({ pair: a.pair, game: a.index, before: a.winningEngine, after: b.winningEngine });
    if (a.winningEngine === 'Rapfi' && b.winningEngine === 'Rapfi') {
      matchedLosses.push({ pair: a.pair, game: a.index, color: a.black === 'Gomoku' ? 'black' : 'white',
        beforePlayedPlies: a.turns.length, afterPlayedPlies: b.turns.length, deltaPlayedPlies: b.turns.length - a.turns.length });
    }
  }
  const deltaStats = rows => ({ ...distribution(rows.map(r => r.deltaPlayedPlies)),
    longer: rows.filter(r => r.deltaPlayedPlies > 0).length, shorter: rows.filter(r => r.deltaPlayedPlies < 0).length,
    unchanged: rows.filter(r => r.deltaPlayedPlies === 0).length });
  return { baseline: lengthStats(baseline), current: lengthStats(current),
    matchedLossDelta: deltaStats(matchedLosses),
    matchedLossDeltaByColor: Object.fromEntries(['black', 'white'].map(c => [c, deltaStats(matchedLosses.filter(r => r.color === c))])),
    changedResults, matchedLosses };
}

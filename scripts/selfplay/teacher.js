import { createHash } from 'node:crypto';
import { DEFAULT_WEIGHTS } from './core.js';

export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Fixed teacher, actual side-to-move perspective, no heuristic root shortcuts. */
export function searchLabel(engine, row, config) {
  const black = new Uint32Array(8), white = new Uint32Array(8);
  const seen = new Set();
  for (const [bits, stones] of [[black, row.black], [white, row.white]]) {
    if (!Array.isArray(stones)) throw new Error('Invalid teacher board');
    for (const p of stones) {
      if (!Number.isInteger(p) || p < 0 || p >= 225 || seen.has(p)) throw new Error('Invalid teacher stone');
      seen.add(p); bits[p >>> 5] |= 1 << (p & 31);
    }
  }
  if (row.ply !== seen.size || row.sideToMove !== (row.ply % 2 ? 'white' : 'black') ||
      row.black.length !== Math.ceil(row.ply / 2) || row.white.length !== Math.floor(row.ply / 2)) {
    throw new Error('Teacher board has inconsistent turn or stone counts');
  }
  const search = new engine.SearchEngine(black, white, row.sideToMove === 'black', config.depth, config.extension, config.tableCapacity);
  let last, nodes = 0;
  try {
    for (;;) {
      const iteration = search.next_depth();
      if (!iteration.length) break;
      last = iteration; nodes += iteration[2];
    }
    if (!last) throw new Error('Teacher position is terminal or has no search result');
    const [depth, score] = last;
    const mate = Math.abs(score) >= 1_000_000 - 225;
    if (!Number.isInteger(score) || Math.abs(score) > 1_000_000 ||
        (depth !== config.depth && !mate)) throw new Error('Teacher did not complete the requested depth');
    const pv = Array.from(last.slice(7, 7 + last[6]));
    if (!pv.length || !Number.isInteger(pv[0]) || pv[0] < 0 || pv[0] >= 225 || seen.has(pv[0])) throw new Error('Teacher returned an illegal principal move');
    return { score, depth, requestedDepth: config.depth, kind: mate ? 'mate' : 'evaluation', pv, nodes,
      engineDigest: config.engineDigest, weights: DEFAULT_WEIGHTS };
  } finally { search.free(); }
}

export function selectRows(rows, limit, seed) {
  return [...rows].sort((a, b) => hash(`${seed}:${a.id}`).localeCompare(hash(`${seed}:${b.id}`)))
    .slice(0, limit || rows.length);
}

export function validateLabel(label, row, config) {
  if (!label || !Number.isInteger(label.score) || Math.abs(label.score) > 1_000_000 ||
      !Number.isInteger(label.depth) || label.depth < 1 || label.depth > config.depth ||
      label.requestedDepth !== config.depth || label.engineDigest !== config.engineDigest ||
      JSON.stringify(label.weights) !== JSON.stringify(DEFAULT_WEIGHTS) ||
      label.kind !== (Math.abs(label.score) >= 1_000_000 - 225 ? 'mate' : 'evaluation') ||
      (label.depth < config.depth && label.kind !== 'mate') ||
      !Number.isSafeInteger(label.nodes) || label.nodes < 0 || !Array.isArray(label.pv) || !label.pv.length) {
    throw new Error('Invalid saved teacher label');
  }
  const occupied = new Set([...row.black, ...row.white]);
  for (const p of label.pv) {
    if (!Number.isInteger(p) || p < 0 || p >= 225 || occupied.has(p)) throw new Error('Invalid saved teacher PV');
    occupied.add(p);
  }
}

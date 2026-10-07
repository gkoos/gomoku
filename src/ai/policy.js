import { BOARD_SIZE, BOARD_CELLS } from '../core/constants.js';

// Per-candidate features and the portable GOMPOL1 candidate-ordering model.
// The feature layout and weight order are shared with engine-rust/src/policy.rs;
// keep POLICY_FEATURES, the magic, and the coefficient order in sync.
export const POLICY_FEATURES = 25;
export const POLICY_MAGIC = [0x47, 0x4f, 0x4d, 0x50, 0x4f, 0x4c, 0x31, 0x00];
const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

const at = (cells, row, col) =>
  row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE
    ? -1
    : cells[row * BOARD_SIZE + col];

/** 0 = empty, 1 = black, 2 = white. */
export function boardCells(blackBitboard, whiteBitboard) {
  const cells = new Uint8Array(BOARD_CELLS);
  for (let slot = 0; slot < 8; slot++) {
    let mask = blackBitboard[slot];
    if (slot === 7) mask &= 1;
    while (mask) {
      cells[slot * 32 + 31 - Math.clz32(mask & -mask)] = 1;
      mask &= mask - 1;
    }
    mask = whiteBitboard[slot];
    if (slot === 7) mask &= 1;
    while (mask) {
      cells[slot * 32 + 31 - Math.clz32(mask & -mask)] = 2;
      mask &= mask - 1;
    }
  }
  return cells;
}

/** Occupied stones within Chebyshev distance two, matching the generator. */
export function neighborhoodDensity(cells) {
  const density = new Uint8Array(BOARD_CELLS);
  for (let p = 0; p < cells.length; p++) {
    if (!cells[p]) continue;
    const row = Math.floor(p / BOARD_SIZE),
      col = p % BOARD_SIZE;
    for (let r = Math.max(0, row - 2); r <= Math.min(BOARD_SIZE - 1, row + 2); r++)
      for (let c = Math.max(0, col - 2); c <= Math.min(BOARD_SIZE - 1, col + 2); c++)
        density[r * BOARD_SIZE + c]++;
  }
  return density;
}

/** Feature vector for one candidate square, independent of any network. */
export function candidateFeatures(cells, position, sideToMove, options) {
  const row = Math.floor(position / BOARD_SIZE),
    col = position % BOARD_SIZE;
  const own = sideToMove === 'black' ? 1 : 2,
    opp = own === 1 ? 2 : 1;
  const features = [
    Math.min(1, options.priority / 1000),
    options.density / 24,
    (14 - Math.abs(row - 7) - Math.abs(col - 7)) / 14,
    (options.tactical ?? 0) / 2,
    options.ply / 224,
  ];
  for (const [dr, dc] of DIRECTIONS) {
    let runPlus = 0,
      k = 1;
    while (k <= 4 && at(cells, row + k * dr, col + k * dc) === own) {
      runPlus++;
      k++;
    }
    const openPlus = k <= 4 && at(cells, row + k * dr, col + k * dc) === 0 ? 1 : 0;
    let runMinus = 0;
    k = 1;
    while (k <= 4 && at(cells, row - k * dr, col - k * dc) === own) {
      runMinus++;
      k++;
    }
    const openMinus = k <= 4 && at(cells, row - k * dr, col - k * dc) === 0 ? 1 : 0;
    let oppPlus = 0;
    k = 1;
    while (k <= 4 && at(cells, row + k * dr, col + k * dc) === opp) {
      oppPlus++;
      k++;
    }
    let oppMinus = 0;
    k = 1;
    while (k <= 4 && at(cells, row - k * dr, col - k * dc) === opp) {
      oppMinus++;
      k++;
    }
    let ownIn4 = 0,
      oppIn4 = 0;
    for (let s = -4; s <= 4; s++) {
      if (s === 0) continue;
      const value = at(cells, row + s * dr, col + s * dc);
      if (value === own) ownIn4++;
      else if (value === opp) oppIn4++;
    }
    features.push(
      Math.min(1, (1 + runPlus + runMinus) / 5),
      (openPlus + openMinus) / 2,
      Math.max(oppPlus, oppMinus) / 4,
      ownIn4 / 8,
      oppIn4 / 8,
    );
  }
  return features;
}

const HEADER = 24;
const coefficientCount = (features, hidden) => (features + 2) * hidden + 1;

/** Parse a GOMPOL1 model. Coefficients are float32, laid out hidden-major per unit. */
export function loadPolicy(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (view.length < HEADER || !POLICY_MAGIC.every((byte, i) => view[i] === byte))
    throw new Error('Invalid policy header');
  const data = new DataView(view.buffer, view.byteOffset, view.byteLength);
  const version = data.getUint32(8, true),
    features = data.getUint32(12, true),
    hidden = data.getUint32(16, true),
    outputs = data.getUint32(20, true);
  if (version !== 1 || outputs !== 1 || features !== POLICY_FEATURES || hidden < 1 || hidden > 512)
    throw new Error('Invalid policy dimensions');
  const count = coefficientCount(features, hidden);
  if (view.length !== HEADER + count * 4) throw new Error('Invalid policy length');
  const values = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const value = data.getFloat32(HEADER + i * 4, true);
    if (!Number.isFinite(value)) throw new Error('Non-finite policy coefficient');
    values[i] = value;
  }
  const biasOffset = features * hidden,
    outputOffset = biasOffset + hidden;
  return {
    features,
    hidden,
    byteLength: view.length,
    score(featureArray) {
      if (featureArray.length !== features) throw new Error('Feature width mismatch');
      let total = values[outputOffset + hidden];
      for (let j = 0; j < hidden; j++) {
        let sum = values[biasOffset + j];
        const base = j * features;
        for (let i = 0; i < features; i++) sum += values[base + i] * featureArray[i];
        total += values[outputOffset + j] * (sum > 0 ? sum : 0);
      }
      return total;
    },
  };
}

/** Build GOMPOL1 bytes from explicit weights (used by tests and tools). */
export function exportPolicy({ features = POLICY_FEATURES, hidden, input, bias, output, outputBias }) {
  if (
    features !== POLICY_FEATURES ||
    !Number.isInteger(hidden) ||
    hidden < 1 ||
    hidden > 512 ||
    input.length !== features * hidden ||
    bias.length !== hidden ||
    output.length !== hidden ||
    !Number.isFinite(outputBias)
  )
    throw new Error('Invalid policy weights');
  const count = coefficientCount(features, hidden);
  const buffer = new ArrayBuffer(HEADER + count * 4);
  const view = new Uint8Array(buffer);
  POLICY_MAGIC.forEach((byte, i) => (view[i] = byte));
  const data = new DataView(buffer);
  data.setUint32(8, 1, true);
  data.setUint32(12, features, true);
  data.setUint32(16, hidden, true);
  data.setUint32(20, 1, true);
  const values = [...Array.from(input), ...Array.from(bias), ...Array.from(output), outputBias];
  for (let i = 0; i < count; i++) data.setFloat32(HEADER + i * 4, values[i], true);
  return view;
}

/**
 * Lazy GOMPOL1 asset loader. The model bytes are fetched once; a load failure
 * resolves to null so the engine keeps its default ordering.
 */
export function createPolicyLoader({
  url,
  fetchBytes = (target) => fetch(target),
  reportError = console.warn,
}) {
  let pending;
  return function loadPolicy() {
    pending ??= Promise.resolve()
      .then(() => fetchBytes(url))
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((buffer) => new Uint8Array(buffer))
      .catch((error) => {
        reportError('Policy model load failed; using the default ordering:', error);
        return null;
      });
    return pending;
  };
}

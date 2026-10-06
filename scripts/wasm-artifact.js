import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = fileURLToPath(new URL('../', import.meta.url));
export const artifactFiles = [
  'gomoku_engine.js',
  'gomoku_engine_bg.wasm',
  'gomoku_engine.d.ts',
];
const normalizedText = (bytes) =>
  bytes.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
export const digest = (bytes, file) =>
  createHash('sha256')
    .update(file?.endsWith('.wasm') ? bytes : normalizedText(bytes))
    .digest('hex');
export function sourceDigest() {
  const files = [
    'engine-rust/Cargo.toml',
    'engine-rust/Cargo.lock',
    'engine-rust/build.rs',
    'scripts/build-wasm.js',
    ...readdirSync(resolve(root, 'engine-rust/src'), { recursive: true })
      .filter((file) => file.endsWith('.rs'))
      .map((file) => 'engine-rust/src/' + file.replaceAll('\\', '/')),
  ].sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(normalizedText(readFileSync(resolve(root, file))));
    hash.update('\0');
  }
  return hash.digest('hex');
}

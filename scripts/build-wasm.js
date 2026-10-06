import { sourceDigest, artifactFiles, digest } from './wasm-artifact.js';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
function run(tool, args) {
  const executable = join(
    homedir(),
    '.cargo',
    'bin',
    tool + (process.platform === 'win32' ? '.exe' : ''),
  );
  const result = spawnSync(existsSync(executable) ? executable : tool, args, {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run('cargo', [
  'build',
  '--lib',
  '--locked',
  '--release',
  '--target',
  'wasm32-unknown-unknown',
  '--manifest-path',
  'engine-rust/Cargo.toml',
]);
const wasm = resolve(
  root,
  'engine-rust/target/wasm32-unknown-unknown/release/gomoku_engine.wasm',
);
for (const target of ['web', 'nodejs']) {
  const output = resolve(root, 'engine-rust/pkg', target);
  mkdirSync(output, { recursive: true });
  run('wasm-bindgen', [wasm, '--target', target, '--out-dir', output]);
  // Node bindings are CommonJS, even though the parent project is an ES module.
  writeFileSync(
    join(output, 'package.json'),
    JSON.stringify({
      type: target === 'nodejs' ? 'commonjs' : 'module',
      private: true,
    }),
  );
}

// Check in browser assets so static hosting builds only need Node/npm.
const browserOutput = resolve(root, 'src/ai/wasm');
mkdirSync(browserOutput, { recursive: true });
const artifacts = {};
for (const file of artifactFiles) {
  const generated = resolve(root, 'engine-rust/pkg/web', file);
  copyFileSync(generated, resolve(browserOutput, file));
  artifacts[file] = digest(readFileSync(generated), file);
}
writeFileSync(
  resolve(browserOutput, 'build.json'),
  JSON.stringify({ sourceHash: sourceDigest(), artifacts }, null, 2) + '\n',
);

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, sourceDigest, artifactFiles, digest } from './wasm-artifact.js';
try {
  const directory = resolve(root, 'src/ai/wasm');
  const manifest = JSON.parse(
    readFileSync(resolve(directory, 'build.json'), 'utf8'),
  );
  if (manifest.sourceHash !== sourceDigest())
    throw new Error('Rust sources changed');
  for (const file of artifactFiles)
    if (
      manifest.artifacts[file] !==
      digest(readFileSync(resolve(directory, file)), file)
    )
      throw new Error('Generated artifact changed: ' + file);
} catch (error) {
  console.error(
    'Browser Wasm assets are missing or stale. Run npm run wasm:build and commit src/ai/wasm with the Rust changes.\n' +
      error.message,
  );
  process.exit(1);
}
console.log('Browser Wasm assets match the Rust sources.');

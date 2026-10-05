import init, { SearchEngine } from './wasm/gomoku_engine.js';
import wasmUrl from './wasm/gomoku_engine_bg.wasm?url';

export async function loadWasmEngine() {
  await init({ module_or_path: wasmUrl });
  return { SearchEngine };
}

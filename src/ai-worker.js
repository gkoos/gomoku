import { createWorkerHandler } from './ai/worker-handler.js';
import { createWasmChooseMove } from './ai/wasm-search.js';
import { loadWasmEngine } from './ai/wasm-runtime.js';

self.addEventListener(
  'message',
  createWorkerHandler({
    postMessage: (message) => self.postMessage(message),
    chooseMove: createWasmChooseMove({ loadEngine: loadWasmEngine }),
  }),
);

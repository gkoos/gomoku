import { createWorkerHandler } from './ai/worker-handler.js';
import { createWasmChooseMove } from './ai/wasm-search.js';
import { createPolicyLoader } from './ai/policy.js';
import { loadWasmEngine } from './ai/wasm-runtime.js';
import { POLICY_MODEL_URL } from './ai/config.js';

const loadPolicy = createPolicyLoader({ url: POLICY_MODEL_URL });

self.addEventListener(
  'message',
  createWorkerHandler({
    postMessage: (message) => self.postMessage(message),
    chooseMove: createWasmChooseMove({ loadEngine: loadWasmEngine, loadPolicy }),
  }),
);

import { createWorkerHandler } from './ai/worker-handler.js';
self.addEventListener(
  'message',
  createWorkerHandler({ postMessage: (message) => self.postMessage(message) }),
);

import './style.css';
import { createGameController } from './game/controller.js';

const game = createGameController({
  document,
  createWorker: () =>
    new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' }),
});
game.initGame();
window.addEventListener('beforeunload', game.cleanup);

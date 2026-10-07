import { chooseMove as engineChooseMove } from './engine.js';
const defaultChooseMove = (
  blackBitboard,
  whiteBitboard,
  toMove,
  _opponent,
  difficulty,
  onProgress,
  { onIteration } = {},
) =>
  engineChooseMove(
    { blackBitboard, whiteBitboard, toMove },
    { difficulty, onProgress, onIteration },
  );
import { findLegalFallback } from '../core/rules.js';
export function createWorkerHandler({
  postMessage,
  chooseMove = defaultChooseMove,
  reportError = console.error,
}) {
  const findBestMove = chooseMove;
  return async function (e) {
    const requestId = e.data?.requestId;
    try {
      const { type, data } = e.data;
      if (type === 'NEW_GAME') {
        return;
      }
      if (type !== 'FIND_BEST_MOVE') return;
      const { blackBitboard, whiteBitboard, toMove } = data.position || data;
      const { difficulty } = data;
      const computerPlayer = toMove || data.computerPlayer;
      const humanPlayer = computerPlayer === 'black' ? 'white' : 'black';
      if (!blackBitboard || !whiteBitboard) {
        postMessage({ type: 'BEST_MOVE_FOUND', requestId, move: null });
        return;
      }
      const move = await findBestMove(
        blackBitboard,
        whiteBitboard,
        computerPlayer,
        humanPlayer,
        difficulty,
        (progress) =>
          postMessage({ type: 'PROGRESS_UPDATE', requestId, progress }),
        {
          onIteration: ({ depth, move }) =>
            postMessage({ type: 'SEARCH_ITERATION', requestId, depth, move }),
          usePolicy: Boolean(data.usePolicy),
        },
      );
      postMessage({ type: 'BEST_MOVE_FOUND', requestId, move });
    } catch (error) {
      reportError('AI Worker error:', error);
      const data = e.data?.data || {};
      const { blackBitboard, whiteBitboard } = data.position || data;
      postMessage({
        type: 'BEST_MOVE_FOUND',
        requestId,
        move: findLegalFallback(blackBitboard, whiteBitboard),
      });
    }
  };
}

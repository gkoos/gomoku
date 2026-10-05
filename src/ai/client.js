import { BOARD_SIZE } from '../core/constants.js';
export function createAiClient({
  createWorker,
  canAcceptResponse = () => true,
  onProgress = () => {},
  onMove = () => {},
  onError = () => {},
  onThinkingChange = () => {},
  reportError = console.error,
  schedule = setTimeout,
  cancelSchedule = clearTimeout,
}) {
  let worker = null,
    nextRequestId = 0,
    pendingRequestId = null,
    resultTimer = null;
  let bestMove = null,
    completedDepth = 0,
    position = null,
    restartAfterForce = false;
  function cancel() {
    pendingRequestId = null;
    bestMove = null;
    completedDepth = 0;
    restartAfterForce = false;
    onThinkingChange(false);
    cancelSchedule(resultTimer);
    resultTimer = null;
    const retired = worker;
    worker = null;
    retired?.terminate();
  }
  function fail(source, error) {
    if (source !== worker) return;
    const hadRequest = pendingRequestId !== null;
    cancel();
    reportError('AI Worker error:', error);
    if (hadRequest && canAcceptResponse()) onError(error);
  }
  function initialize() {
    cancel();
    try {
      const source = createWorker();
      worker = source;
      source.onmessage = ({ data }) => {
        const { type, move, progress, requestId, depth } = data || {};
        if (
          source !== worker ||
          pendingRequestId === null ||
          requestId !== pendingRequestId ||
          !canAcceptResponse()
        )
          return;
        if (type === 'SEARCH_ITERATION') {
          if (
            Number.isInteger(depth) &&
            depth > completedDepth &&
            legal(move)
          ) {
            bestMove = move;
            completedDepth = depth;
          }
        } else if (type === 'PROGRESS_UPDATE') onProgress(progress);
        else if (type === 'BEST_MOVE_FOUND' && resultTimer === null) {
          if (legal(move)) bestMove = move;
          onProgress(100);
          resultTimer = schedule(() => {
            if (
              source !== worker ||
              requestId !== pendingRequestId ||
              !canAcceptResponse()
            )
              return;
            resultTimer = null;
            pendingRequestId = null;
            onThinkingChange(false);
            onMove(move);
          }, 150);
        }
      };
      source.onerror = (error) => fail(source, error);
      source.onmessageerror = (error) => fail(source, error);
      return true;
    } catch (error) {
      reportError('Failed to create AI worker:', error);
      worker = null;
      return false;
    }
  }
  function findMove(data, fallbackMove = null) {
    if (pendingRequestId !== null || !canAcceptResponse()) return;
    if (!worker && restartAfterForce) initialize();
    if (!worker) {
      onError();
      return;
    }
    position = data.position || data;
    completedDepth = 0;
    bestMove = legal(fallbackMove) ? fallbackMove : null;
    pendingRequestId = ++nextRequestId;
    onThinkingChange(true);
    const source = worker;
    try {
      source.postMessage({
        type: 'FIND_BEST_MOVE',
        requestId: pendingRequestId,
        data,
      });
    } catch (error) {
      fail(source, error);
    }
  }
  function legal(move) {
    if (
      !position ||
      !move ||
      !Number.isInteger(move.row) ||
      !Number.isInteger(move.col) ||
      move.row < 0 ||
      move.row >= BOARD_SIZE ||
      move.col < 0 ||
      move.col >= BOARD_SIZE
    )
      return false;
    const index = move.row * BOARD_SIZE + move.col;
    return (
      ((position.blackBitboard[index >>> 5] |
        position.whiteBitboard[index >>> 5]) &
        (1 << (index % 32))) ===
      0
    );
  }
  function forceMove() {
    if (pendingRequestId === null || !canAcceptResponse() || !bestMove)
      return false;
    const move = bestMove;
    cancel(); // terminate synchronous search; a worker cannot process a stop message while searching
    restartAfterForce = true;
    onMove(move);
    return true;
  }
  return {
    initialize,
    forceMove,
    get completedDepth() {
      return completedDepth;
    },
    findMove,
    cancel,
    dispose: cancel,
    get available() {
      return worker !== null;
    },
    get pendingRequestId() {
      return pendingRequestId;
    },
  };
}

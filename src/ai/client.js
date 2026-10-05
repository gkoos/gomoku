export function createAiClient({
  createWorker,
  canAcceptResponse = () => true,
  onProgress = () => {},
  onMove = () => {},
  onError = () => {},
  reportError = console.error,
  schedule = setTimeout,
  cancelSchedule = clearTimeout,
}) {
  let worker = null,
    nextRequestId = 0,
    pendingRequestId = null,
    resultTimer = null;
  function cancel() {
    pendingRequestId = null;
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
        const { type, move, progress, requestId } = data || {};
        if (
          source !== worker ||
          pendingRequestId === null ||
          requestId !== pendingRequestId ||
          !canAcceptResponse()
        )
          return;
        if (type === 'PROGRESS_UPDATE') onProgress(progress);
        else if (type === 'BEST_MOVE_FOUND' && resultTimer === null) {
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
  function findMove(data) {
    if (pendingRequestId !== null || !canAcceptResponse()) return;
    if (!worker) {
      onError();
      return;
    }
    pendingRequestId = ++nextRequestId;
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
  return {
    initialize,
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

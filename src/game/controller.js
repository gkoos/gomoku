import { generateCandidateMoves } from '../ai/moves.js';
import { BOARD_SIZE } from '../core/constants.js';
import { board2Bitboards } from '../core/bitboards.js';
import { getBoardResult, getWinningLine } from '../core/rules.js';
import { createAiClient } from '../ai/client.js';
import { createSetupState } from './setup.js';
import { createView } from '../ui/view.js';

export function createGameController({
  document,
  createWorker,
  Setup = createSetupState(),
  setTimeout = globalThis.setTimeout,
  clearTimeout = globalThis.clearTimeout,
  alert = globalThis.alert,
  reportError = console.error,
}) {
  // Game state

  let board = [];
  let currentPlayer = 'black';
  let phase = 'idle';
  let humanPlayer = 'black'; // Human player color
  let computerPlayer = 'white'; // Computer player color
  let aiDifficulty = 'medium'; // AI difficulty: easy, medium, hard

  let gameGeneration = 0;
  let openingTimer = null;

  function canComputerMove() {
    return (
      isGameInProgress() &&
      !isGameOver() &&
      !Setup.isSetupMode() &&
      currentPlayer === computerPlayer
    );
  }

  function cancelAIWork() {
    gameGeneration++;
    clearTimeout(openingTimer);
    openingTimer = null;
    aiClient.cancel();
  }

  function finishTerminalPosition() {
    const result = getBoardResult(board);
    if (!result) return false;
    phase = 'finished';
    if (result.winner) {
      highlightWinningStones(result.winningPositions);
      updateGameStatus(
        result.winner === humanPlayer ? 'You Win!' : 'Computer Wins!',
      );
    } else {
      updateGameStatus(
        result.invalid ? 'Invalid board position.' : 'Game Draw!',
      );
    }
    return true;
  }

  const aiClient = createAiClient({
    createWorker,
    schedule: setTimeout,
    cancelSchedule: clearTimeout,
    reportError,
    canAcceptResponse: canComputerMove,
    onProgress: (progress) => updateAIProgress(progress),
    onThinkingChange: (thinking) => view.setThinking(thinking),
    onError: makeRandomMove,
    onMove(move) {
      if (finishTerminalPosition()) return;
      if (
        move &&
        Number.isInteger(move.row) &&
        Number.isInteger(move.col) &&
        move.row >= 0 &&
        move.row < BOARD_SIZE &&
        move.col >= 0 &&
        move.col < BOARD_SIZE &&
        board[move.row][move.col] === null
      )
        makeMove(move.row, move.col, true);
      else makeRandomMove();
    },
  });
  function initAIWorker() {
    aiClient.initialize();
  }

  // Initialize the game
  function initGame() {
    cancelAIWork();
    Setup.exitSetupMode();
    // Initialize empty board
    board = Array(BOARD_SIZE)
      .fill(null)
      .map(() => Array(BOARD_SIZE).fill(null));
    currentPlayer = 'black';
    phase = 'idle';

    // Initialize AI worker if not already done
    if (!aiClient.available) {
      initAIWorker();
    }

    // Create the game UI
    createGameUI();
    createBoard();
    updateGameStatus();

    // Ensure board starts disabled
    view.disableBoard();
  }

  // Start the game
  function startGame() {
    if (isGameInProgress() || Setup.isSetupMode()) return;
    phase = 'playing';

    view.showPlayingControls();
    updateGameStatus();

    // If computer goes first (human chose white), make computer move
    if (humanPlayer === 'white') {
      const generation = gameGeneration;
      openingTimer = setTimeout(() => {
        if (generation !== gameGeneration || !canComputerMove()) return;
        openingTimer = null;
        makeComputerMove();
      }, 500);
    }
  }

  // Make a move
  function makeMove(row, col, isComputerMove = false) {
    if (
      !isGameInProgress() ||
      Setup.isSetupMode() ||
      isGameOver() ||
      !Number.isInteger(row) ||
      !Number.isInteger(col) ||
      row < 0 ||
      row >= BOARD_SIZE ||
      col < 0 ||
      col >= BOARD_SIZE ||
      board[row][col] !== null
    ) {
      return;
    }

    // If it's not a computer move and it's not the human's turn, ignore
    if (!isComputerMove && currentPlayer !== humanPlayer) {
      return;
    }

    // If it's a computer move and it's not the computer's turn, ignore
    if (isComputerMove && currentPlayer !== computerPlayer) {
      return;
    }

    board[row][col] = currentPlayer;
    view.placeStone(row, col, currentPlayer);

    // Check for win condition
    if (checkWin(row, col)) {
      phase = 'finished';
      const winner =
        currentPlayer === humanPlayer ? 'You Win!' : 'Computer Wins!';
      updateGameStatus(winner);
      return;
    }

    // Check for draw (board full)
    if (isBoardFull()) {
      phase = 'finished';
      updateGameStatus('Game Draw!');
      return;
    }

    // Switch players
    currentPlayer = currentPlayer === 'black' ? 'white' : 'black';
    updateGameStatus();

    // If it's now the computer's turn, make computer move
    if (!isGameOver() && currentPlayer === computerPlayer) {
      makeComputerMove();
    }
  }

  // Fallback function to make a random move if AI fails
  function makeRandomMove() {
    if (!canComputerMove() || finishTerminalPosition()) return;

    // First, try to find moves near existing stones
    const smartMoves = [];
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        if (board[row][col] !== null) {
          // Check adjacent positions
          for (let dRow = -1; dRow <= 1; dRow++) {
            for (let dCol = -1; dCol <= 1; dCol++) {
              if (dRow === 0 && dCol === 0) continue;

              const newRow = row + dRow;
              const newCol = col + dCol;

              if (
                newRow >= 0 &&
                newRow < BOARD_SIZE &&
                newCol >= 0 &&
                newCol < BOARD_SIZE &&
                board[newRow][newCol] === null
              ) {
                smartMoves.push({ row: newRow, col: newCol });
              }
            }
          }
        }
      }
    }

    // Remove duplicates
    const uniqueSmartMoves = smartMoves.filter(
      (move, index, self) =>
        index ===
        self.findIndex((m) => m.row === move.row && m.col === move.col),
    );

    let moveToMake;
    if (uniqueSmartMoves.length > 0) {
      // Use smart moves (near existing stones)
      const randomIndex = Math.floor(Math.random() * uniqueSmartMoves.length);
      moveToMake = uniqueSmartMoves[randomIndex];
    } else {
      // Fall back to any empty position
      const emptyPositions = [];
      for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
          if (board[row][col] === null) {
            emptyPositions.push({ row, col });
          }
        }
      }

      if (emptyPositions.length > 0) {
        const randomIndex = Math.floor(Math.random() * emptyPositions.length);
        moveToMake = emptyPositions[randomIndex];
      } else {
        return;
      }
    }

    makeMove(moveToMake.row, moveToMake.col, true);
  }

  // Computer AI - using web worker
  function makeComputerMove() {
    if (
      !canComputerMove() ||
      aiClient.pendingRequestId !== null ||
      finishTerminalPosition()
    )
      return;
    const { blackBitboard, whiteBitboard } = board2Bitboards(board);
    const fallback = generateCandidateMoves(
      blackBitboard,
      whiteBitboard,
      computerPlayer,
    )[0];
    aiClient.findMove(
      {
        position: { blackBitboard, whiteBitboard, toMove: computerPlayer },
        difficulty: aiDifficulty,
      },
      fallback,
    );
  }

  // Check win condition (5 in a row)
  function checkWin(row, col) {
    const positions = getWinningLine(board, row, col);
    if (!positions) return false;
    highlightWinningStones(positions);
    return true;
  }

  // Check if board is full
  function isBoardFull() {
    return board.every((row) => row.every((cell) => cell !== null));
  }

  // Cleanup function for web worker
  function cleanup() {
    cancelAIWork();
  }

  // Handle cell click in setup mode
  function handleSetupCellClick(row, col) {
    view.showSetupCell(row, col, Setup.toggleSetupCell(row, col));
  }

  // Clear setup board function
  function clearSetupBoard() {
    Setup.clearSetupBoard();
    updateBoardDisplay();
  }

  // Setup mode functions
  function enterSetupMode() {
    if (isGameInProgress() && !isGameOver()) return;
    cancelAIWork();
    phase = 'setup';
    currentPlayer = 'black';
    board = Array(BOARD_SIZE)
      .fill(null)
      .map(() => Array(BOARD_SIZE).fill(null));
    Setup.enterSetupMode();
    createGameUI();
    createBoard();
    updateGameStatus();
  }

  function exitSetupMode() {
    Setup.exitSetupMode();
    initGame();
  }

  function startGameFromSetup() {
    if (!Setup.validateSetup()) {
      alert('Invalid board setup. Please check your configuration.');
      return;
    }
    const setupData = Setup.getSetupBoardForGame();
    cancelAIWork();
    computerPlayer = setupData.computerColor;
    humanPlayer = setupData.humanColor;
    currentPlayer = setupData.nextMove;
    board = setupData.board;
    Setup.exitSetupMode();
    phase = 'playing';
    createGameUI();
    createBoard();
    updateBoardDisplay();
    if (finishTerminalPosition()) return;
    updateGameStatus();
    initAIWorker();
    if (currentPlayer === computerPlayer) makeComputerMove();
  }

  function forceComputerMove() {
    return aiClient.forceMove();
  }

  function isGameInProgress() {
    return phase === 'playing' || phase === 'finished';
  }
  function isGameOver() {
    return phase === 'finished';
  }
  function getState() {
    return {
      board: board.map((row) => [...row]),
      currentPlayer,
      humanPlayer,
      computerPlayer,
      aiDifficulty,
      gameOver: isGameOver(),
      gameInProgress: isGameInProgress(),
      activeAIRequest: aiClient.pendingRequestId,
      completedDepth: aiClient.completedDepth,
      phase,
    };
  }
  function setHumanPlayer(color) {
    if (isGameInProgress() || !['black', 'white'].includes(color)) return;
    humanPlayer = color;
    computerPlayer = color === 'black' ? 'white' : 'black';
  }
  function setDifficulty(value) {
    if (!isGameInProgress() && ['easy', 'medium', 'hard'].includes(value))
      aiDifficulty = value;
  }
  const view = createView({
    document,
    Setup,
    getState,
    initGame,
    startGame,
    enterSetupMode,
    clearSetupBoard,
    startGameFromSetup,
    exitSetupMode,
    handleSetupCellClick,
    makeMove,
    setHumanPlayer,
    setDifficulty,
    forceComputerMove,
  });
  const {
    createGameUI,
    createBoard,
    highlightWinningStones,
    updateGameStatus,
    updateAIProgress,
    updateBoardDisplay,
  } = view;

  return {
    initGame,
    startGame,
    enterSetupMode,
    clearSetupBoard,
    startGameFromSetup,
    exitSetupMode,
    handleSetupCellClick,
    makeMove,
    setHumanPlayer,
    setDifficulty,
    makeComputerMove,
    forceComputerMove,
    cleanup,
    getState,
    Setup,
  };
}

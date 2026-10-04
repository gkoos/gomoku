import './style.css'
import { board2Bitboards } from './bitboards.js'
import * as Setup from './setup.js'
import { getBoardResult, getWinningLine } from './rules.js'

// Game state
const BOARD_SIZE = 15;
let board = [];
let currentPlayer = 'black';
let gameOver = false;
let humanPlayer = 'black'; // Human player color
let computerPlayer = 'white'; // Computer player color
let aiDifficulty = 'medium'; // AI difficulty: easy, medium, hard
let gameInProgress = false;
let aiWorker = null; // AI Web Worker

let gameGeneration = 0;
let nextRequestId = 0;
let activeAIRequest = null;
let aiResultTimer = null;
let openingTimer = null;

function canComputerMove() {
  return gameInProgress && !gameOver && !Setup.isSetupMode() && currentPlayer === computerPlayer;
}

function cancelAIWork() {
  gameGeneration++;
  activeAIRequest = null;
  clearTimeout(aiResultTimer);
  clearTimeout(openingTimer);
  aiResultTimer = null;
  openingTimer = null;
  if (aiWorker) aiWorker.terminate();
  aiWorker = null;
}

function finishTerminalPosition() {
  const result = getBoardResult(board);
  if (!result) return false;
  gameOver = true;
  if (result.winner) {
    highlightWinningStones(result.winningPositions);
    updateGameStatus(result.winner === humanPlayer ? 'You Win!' : 'Computer Wins!');
  } else {
    updateGameStatus(result.invalid ? 'Invalid board position.' : 'Game Draw!');
  }
  return true;
}

function handleWorkerFailure(worker, error) {
  if (worker !== aiWorker) return;
  console.error('AI Worker error:', error);
  const hadPendingRequest = activeAIRequest !== null;
  activeAIRequest = null;
  clearTimeout(aiResultTimer);
  aiResultTimer = null;
  worker.terminate();
  aiWorker = null;
  if (hadPendingRequest && canComputerMove()) makeRandomMove();
}

// Initialize the AI worker
function initAIWorker() {
  try {
    const worker = new Worker(new URL('./ai-worker.js', import.meta.url));
    aiWorker = worker;
    worker.onmessage = function(e) {
      const { type, move, progress, requestId } = e.data;
      if (worker !== aiWorker || requestId !== activeAIRequest || !canComputerMove()) return;
      if (type === 'PROGRESS_UPDATE') {
        updateAIProgress(progress);
      } else if (type === 'BEST_MOVE_FOUND' && aiResultTimer === null) {
        updateAIProgress(100);
        aiResultTimer = setTimeout(() => {
          if (worker !== aiWorker || requestId !== activeAIRequest || !canComputerMove()) return;
          aiResultTimer = null;
          activeAIRequest = null;
          if (finishTerminalPosition()) return;
          if (move && Number.isInteger(move.row) && Number.isInteger(move.col) &&
              move.row >= 0 && move.row < BOARD_SIZE && move.col >= 0 && move.col < BOARD_SIZE &&
              board[move.row][move.col] === null) {
            makeMove(move.row, move.col, true);
          } else {
            makeRandomMove();
          }
        }, 150);
      }
    };
    worker.onerror = error => handleWorkerFailure(worker, error);
    worker.onmessageerror = error => handleWorkerFailure(worker, error);
  } catch (error) {
    console.error('Failed to create AI worker:', error);
    aiWorker = null;
  }
}

// Initialize the game
function initGame() {
  cancelAIWork();
  Setup.exitSetupMode();
  // Initialize empty board
  board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
  currentPlayer = 'black';
  gameOver = false;
  gameInProgress = false;
  
  // Initialize AI worker if not already done
  if (!aiWorker) {
    initAIWorker();
  }
  
  // Create the game UI
  createGameUI();
  createBoard();
  updateGameStatus();
  
  // Ensure board starts disabled
  const boardElement = document.getElementById('game-board');
  if (boardElement) {
    boardElement.classList.add('disabled');
  }
}

// Create the main game UI
function createGameUI() {
  const isSetupMode = Setup.isSetupMode();
  const setupState = Setup.getSetupState();
  
  document.querySelector('#app').innerHTML = `
    <div class="game-container">
      <h1>Gomoku</h1>
      <div class="player-selector">
        ${!isSetupMode ? `
          <label>Play as:</label>
          <select id="player-color" ${gameInProgress ? 'disabled' : ''}>
            <option value="black" ${humanPlayer === 'black' ? 'selected' : ''}>Black (First)</option>
            <option value="white" ${humanPlayer === 'white' ? 'selected' : ''}>White (Second)</option>
          </select>
          <label>AI Difficulty:</label>
          <select id="ai-difficulty" ${gameInProgress ? 'disabled' : ''}>
            <option value="easy" ${aiDifficulty === 'easy' ? 'selected' : ''}>Easy</option>
            <option value="medium" ${aiDifficulty === 'medium' ? 'selected' : ''}>Medium</option>
            <option value="hard" ${aiDifficulty === 'hard' ? 'selected' : ''}>Hard</option>
          </select>
          <button id="start-btn" class="start-button" ${gameInProgress ? 'style="visibility: hidden;"' : ''}>Start Game</button>
          <button id="setup-btn" class="start-button" ${gameInProgress ? 'style="visibility: hidden;"' : ''}>Setup Board</button>
        ` : `
          <label>Computer:</label>
          <select id="setup-computer-color">
            <option value="black" ${setupState.computerColor === 'black' ? 'selected' : ''}>Black</option>
            <option value="white" ${setupState.computerColor === 'white' ? 'selected' : ''}>White</option>
          </select>
          <label>Next Move:</label>
          <select id="setup-next-move">
            <option value="black" ${setupState.nextMove === 'black' ? 'selected' : ''}>Black</option>
            <option value="white" ${setupState.nextMove === 'white' ? 'selected' : ''}>White</option>
          </select>
          <button id="setup-start-btn" class="start-button">Start Game</button>
          <button id="setup-cancel-btn" class="start-button">Cancel</button>
        `}
      </div>
      <div class="game-info">
        <div id="game-status"></div>
        ${isSetupMode ? 
          '<button id="clear-board-btn" class="reset-button">Clear Board</button>' :
          `<button id="reset-btn" class="reset-button" ${!gameInProgress ? 'style="visibility: hidden;"' : ''}>New Game</button>`
        }
      </div>
      <div id="game-board" class="board"></div>
    </div>
  `;
  
  // Add event listeners based on mode
  if (!isSetupMode) {
    document.getElementById('reset-btn').addEventListener('click', initGame);
    document.getElementById('start-btn').addEventListener('click', startGame);
    document.getElementById('setup-btn').addEventListener('click', enterSetupMode);
    document.getElementById('player-color').addEventListener('change', (e) => {
      humanPlayer = e.target.value;
      computerPlayer = humanPlayer === 'black' ? 'white' : 'black';
    });
    document.getElementById('ai-difficulty').addEventListener('change', (e) => {
      aiDifficulty = e.target.value;
    });
  } else {
    document.getElementById('clear-board-btn').addEventListener('click', clearSetupBoard);
    document.getElementById('setup-start-btn').addEventListener('click', startGameFromSetup);
    document.getElementById('setup-cancel-btn').addEventListener('click', exitSetupMode);
    document.getElementById('setup-computer-color').addEventListener('change', (e) => {
      Setup.setSetupComputerColor(e.target.value);
    });
    document.getElementById('setup-next-move').addEventListener('change', (e) => {
      Setup.setSetupNextMove(e.target.value);
    });
  }
}

// Create the game board
function createBoard() {
  const boardElement = document.getElementById('game-board');
  boardElement.innerHTML = '';
  
  // Apply disabled class if game is not in progress and not in setup mode
  if (!gameInProgress && !Setup.isSetupMode()) {
    boardElement.classList.add('disabled');
  } else {
    boardElement.classList.remove('disabled');
  }
  
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = row;
      cell.dataset.col = col;
      
      // Mark the center cell (7,7 in 0-indexed 15x15 board)
      if (row === 7 && col === 7) {
        cell.classList.add('center-marker');
      }
      
      cell.addEventListener('click', () => {
        if (Setup.isSetupMode()) {
          handleSetupCellClick(row, col);
        } else {
          makeMove(row, col);
        }
      });
      boardElement.appendChild(cell);
    }
  }
}

// Start the game
function startGame() {
  if (gameInProgress || Setup.isSetupMode()) return;
  gameInProgress = true;
  
  // Clear AI caches for new game
  if (aiWorker) {
    const worker = aiWorker;
    try {
      worker.postMessage({ type: 'NEW_GAME' });
    } catch (error) {
      handleWorkerFailure(worker, error);
    }
  }
  
  // Update UI
  document.getElementById('player-color').disabled = true;
  document.getElementById('ai-difficulty').disabled = true;
  document.getElementById('start-btn').style.visibility = 'hidden';
  document.getElementById('setup-btn').style.visibility = 'hidden';
  document.getElementById('reset-btn').style.visibility = 'visible';
  
  // Enable the board
  const boardElement = document.getElementById('game-board');
  boardElement.classList.remove('disabled');
  
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
  if (!gameInProgress || Setup.isSetupMode() || gameOver ||
      !Number.isInteger(row) || !Number.isInteger(col) ||
      row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE ||
      board[row][col] !== null) {
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
  
  // Clear previous last move highlight
  const previousLastMove = document.querySelector('.last-move');
  if (previousLastMove) {
    previousLastMove.classList.remove('last-move');
  }
  
  // Place the stone
  board[row][col] = currentPlayer;
  const cell = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
  cell.classList.add('stone', currentPlayer, 'last-move');
  
  // Check for win condition
  if (checkWin(row, col)) {
    gameOver = true;
    const winner = currentPlayer === humanPlayer ? 'You Win!' : 'Computer Wins!';
    updateGameStatus(winner);
    return;
  }
  
  // Check for draw (board full)
  if (isBoardFull()) {
    gameOver = true;
    updateGameStatus('Game Draw!');
    return;
  }
  
  // Switch players
  currentPlayer = currentPlayer === 'black' ? 'white' : 'black';
  updateGameStatus();
  
  // If it's now the computer's turn, make computer move
  if (!gameOver && currentPlayer === computerPlayer) {
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
            
            if (newRow >= 0 && newRow < BOARD_SIZE && 
                newCol >= 0 && newCol < BOARD_SIZE && 
                board[newRow][newCol] === null) {
              smartMoves.push({ row: newRow, col: newCol });
            }
          }
        }
      }
    }
  }
  
  // Remove duplicates
  const uniqueSmartMoves = smartMoves.filter((move, index, self) => 
    index === self.findIndex(m => m.row === move.row && m.col === move.col)
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
  if (!canComputerMove() || activeAIRequest !== null) return;
  if (finishTerminalPosition()) return;
  if (!aiWorker) {
    makeRandomMove();
    return;
  }
  const { blackBitboard, whiteBitboard } = board2Bitboards(board);
  const worker = aiWorker;
  activeAIRequest = ++nextRequestId;
  try {
    worker.postMessage({
      type: 'FIND_BEST_MOVE',
      requestId: activeAIRequest,
      data: { blackBitboard, whiteBitboard, computerPlayer, humanPlayer, difficulty: aiDifficulty },
    });
  } catch (error) {
    handleWorkerFailure(worker, error);
  }
}

// Check win condition (5 in a row)
function checkWin(row, col) {
  const positions = getWinningLine(board, row, col);
  if (!positions) return false;
  highlightWinningStones(positions);
  return true;
}

// Highlight the winning stones
function highlightWinningStones(positions) {
  positions.forEach(([row, col]) => {
    const cell = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
    if (cell) {
      cell.classList.add('winning-stone');
    }
  });
}

// Check if board is full
function isBoardFull() {
  return board.every(row => row.every(cell => cell !== null));
}

// Update game status display
function updateGameStatus(message = null) {
  const statusElement = document.getElementById('game-status');
  if (message) {
    statusElement.innerHTML = message;
    statusElement.classList.add('game-over');
    statusElement.classList.remove('no-game');
  } else if (Setup.isSetupMode()) {
    statusElement.innerHTML = 'Setup Board';
    statusElement.classList.remove('game-over', 'no-game');
  } else if (!gameInProgress) {
    statusElement.innerHTML = '';
    statusElement.classList.remove('game-over');
    statusElement.classList.add('no-game');
  } else {
    if (currentPlayer === humanPlayer) {
      statusElement.innerHTML = 'Your Turn';
      statusElement.classList.remove('game-over', 'no-game');
    } else {
      // Computer's turn - show progress bar
      statusElement.innerHTML = `
        <div class="progress-container">
          <div class="progress-text">AI Thinking...</div>
          <div class="progress-bar">
            <div class="progress-fill animated" id="ai-progress"></div>
          </div>
        </div>
      `;
      statusElement.classList.remove('game-over', 'no-game');
    }
  }
}

function updateAIProgress(progress) {
  const progressFill = document.getElementById('ai-progress');
  if (progressFill) {
    progressFill.style.width = `${Math.min(100, Math.max(0, progress))}%`;
    
    // Remove animation when near completion
    if (progress >= 95) {
      progressFill.classList.remove('animated');
    }
  }
}

// Cleanup function for web worker
function cleanup() {
  cancelAIWork();
}

// Add cleanup on page unload
window.addEventListener('beforeunload', cleanup);

// Handle cell click in setup mode
function handleSetupCellClick(row, col) {
  const newState = Setup.toggleSetupCell(row, col);
  const cell = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
  
  // Remove existing stone classes
  cell.classList.remove('stone', 'black', 'white');
  
  // Add new state if not empty
  if (newState) {
    cell.classList.add('stone', newState);
  }
}

// Update board display to show current board state
function updateBoardDisplay() {
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
      const stone = board[row][col];
      
      // Remove existing stone classes
      cell.classList.remove('stone', 'black', 'white', 'last-move');
      
      // Add stone class if there's a stone
      if (stone) {
        cell.classList.add('stone', stone);
      }
    }
  }
}

// Clear setup board function
function clearSetupBoard() {
  Setup.clearSetupBoard();
  updateBoardDisplay();
}

// Setup mode functions
function enterSetupMode() {
  if (gameInProgress && !gameOver) return;
  cancelAIWork();
  gameInProgress = false;
  gameOver = false;
  currentPlayer = 'black';
  board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
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
  gameInProgress = true;
  gameOver = false;
  createGameUI();
  createBoard();
  updateBoardDisplay();
  if (finishTerminalPosition()) return;
  updateGameStatus();
  initAIWorker();
  if (currentPlayer === computerPlayer) makeComputerMove();
}

// Start the game
initGame();

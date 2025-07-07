import './style.css'
import { board2Bitboards } from './bitboards.js'

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

// Initialize the AI worker
function initAIWorker() {
  try {
    console.log('Loading traditional worker for maximum compatibility...');
    aiWorker = new Worker(new URL('./ai-worker.js', import.meta.url));
    console.log('Traditional worker created successfully');
    
    aiWorker.onmessage = function(e) {
      const { type, move, progress, message } = e.data;
      
      if (type === 'PROGRESS_UPDATE') {
        updateAIProgress(progress);
      } else if (type === 'BEST_MOVE_FOUND') {
        // Set progress to 100% when move is found
        updateAIProgress(100);
        
        // Small delay to show 100% completion before making the move
        setTimeout(() => {
          if (move) {
            // Check if the move is valid before attempting it
            if (board[move.row][move.col] === null && !gameOver) {
              makeMove(move.row, move.col, true);
            } else {
              // AI returned an invalid move, make a random move instead
              makeRandomMove();
            }
          } else {
            // As a fallback, make a random move
            makeRandomMove();
          }
        }, 150); // Brief delay to show completion
      } else if (type === 'DEBUG') {
        console.log(message);
      }
    };
    
    aiWorker.onerror = function(error) {
      console.error('AI Worker error:', error);
      console.error('Error details:', error.message, error.filename, error.lineno, error.colno, error.error);
      // AI Worker error - make a random move as fallback
      makeRandomMove();
    };

    aiWorker.onmessageerror = function(error) {
      console.error('AI Worker message error:', error);
      makeRandomMove();
    };

  } catch (error) {
    console.error('Failed to create AI worker:', error);
    // Fallback to random moves if worker creation fails
    aiWorker = null;
  }
}

// Initialize the game
function initGame() {
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
  document.querySelector('#app').innerHTML = `
    <div class="game-container">
      <h1>Gomoku</h1>
      <div class="player-selector">
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
      </div>
      <div class="game-info">
        <div id="game-status"></div>
        <button id="reset-btn" class="reset-button" ${!gameInProgress ? 'style="visibility: hidden;"' : ''}>New Game</button>
      </div>
      <div id="game-board" class="board"></div>
    </div>
  `;
  
  // Add event listeners
  document.getElementById('reset-btn').addEventListener('click', initGame);
  document.getElementById('start-btn').addEventListener('click', startGame);
  document.getElementById('player-color').addEventListener('change', (e) => {
    humanPlayer = e.target.value;
    computerPlayer = humanPlayer === 'black' ? 'white' : 'black';
  });
  document.getElementById('ai-difficulty').addEventListener('change', (e) => {
    aiDifficulty = e.target.value;
  });
}

// Create the game board
function createBoard() {
  const boardElement = document.getElementById('game-board');
  boardElement.innerHTML = '';
  
  // Apply disabled class if game is not in progress
  if (!gameInProgress) {
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
      
      cell.addEventListener('click', () => makeMove(row, col));
      boardElement.appendChild(cell);
    }
  }
}

// Start the game
function startGame() {
  gameInProgress = true;
  
  // Clear AI caches for new game
  if (aiWorker) {
    aiWorker.postMessage({
      type: 'NEW_GAME'
    });
  }
  
  // Update UI
  document.getElementById('player-color').disabled = true;
  document.getElementById('ai-difficulty').disabled = true;
  document.getElementById('start-btn').style.visibility = 'hidden';
  document.getElementById('reset-btn').style.visibility = 'visible';
  
  // Enable the board
  const boardElement = document.getElementById('game-board');
  boardElement.classList.remove('disabled');
  
  updateGameStatus();
  
  // If computer goes first (human chose white), make computer move
  if (humanPlayer === 'white') {
    setTimeout(() => makeComputerMove(), 500);
  }
}

// Make a move
function makeMove(row, col, isComputerMove = false) {
  if (gameOver || board[row][col] !== null) {
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
  
  // If game hasn't started yet, ignore
  if (!gameInProgress && !isComputerMove) {
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
  if (gameOver || !gameInProgress) {
    return;
  }
  
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
  if (gameOver || !gameInProgress) {
    return;
  }
  
  // Convert board to bitboards
  const { blackBitboard, whiteBitboard } = board2Bitboards(board);
  // Send bitboards to AI worker
  aiWorker.postMessage({
    type: 'FIND_BEST_MOVE',
    data: {
      blackBitboard,
      whiteBitboard,
      computerPlayer,
      humanPlayer,
      difficulty: aiDifficulty
    }
  });
}

// Check win condition (5 in a row)
function checkWin(row, col) {
  const directions = [
    [0, 1],   // horizontal
    [1, 0],   // vertical
    [1, 1],   // diagonal \
    [1, -1]   // diagonal /
  ];
  
  for (const [dRow, dCol] of directions) {
    const winningPositions = [];
    
    // Check in negative direction first
    let r = row - dRow;
    let c = col - dCol;
    while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === currentPlayer) {
      winningPositions.unshift([r, c]); // Add to beginning to maintain order
      r -= dRow;
      c -= dCol;
    }
    
    // Add the current position
    winningPositions.push([row, col]);
    
    // Check in positive direction
    r = row + dRow;
    c = col + dCol;
    while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === currentPlayer) {
      winningPositions.push([r, c]);
      r += dRow;
      c += dCol;
    }
    
    if (winningPositions.length >= 5) {
      // Highlight exactly 5 stones (take first 5 if more than 5)
      highlightWinningStones(winningPositions.slice(0, 5));
      return true;
    }
  }
  
  return false;
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
  if (aiWorker) {
    aiWorker.terminate();
    aiWorker = null;
  }
}

// Add cleanup on page unload
window.addEventListener('beforeunload', cleanup);

// Start the game
initGame();

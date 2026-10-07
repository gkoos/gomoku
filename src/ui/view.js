import { BOARD_SIZE } from '../core/constants.js';
export function createView({
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
  setUsePolicy,
  forceComputerMove,
}) {
  function createGameUI() {
    const { board, currentPlayer, humanPlayer, aiDifficulty, usePolicy, gameInProgress } =
      getState();
    const isSetupMode = Setup.isSetupMode();
    const setupState = Setup.getSetupState();

    document.querySelector('#app').innerHTML = `
    <div class="game-container">
      <h1>Gomoku</h1>
      <div class="player-selector">
        ${
          !isSetupMode
            ? `
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
            <option value="expert" ${aiDifficulty === 'expert' ? 'selected' : ''}>Expert</option>
          </select>
          <label title="Learned move ordering trained on depth-6 self-play labels"><input type="checkbox" id="use-policy" ${usePolicy ? 'checked' : ''} ${gameInProgress ? 'disabled' : ''}> Stronger (learned ordering)</label>
          <button id="start-btn" class="start-button" ${gameInProgress ? 'style="visibility: hidden;"' : ''}>Start Game</button>
          <button id="setup-btn" class="start-button" ${gameInProgress ? 'style="visibility: hidden;"' : ''}>Setup Board</button>
        `
            : `
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
        `
        }
      </div>
      <div class="game-info">
        <div id="game-status"></div>
        ${!isSetupMode ? `<button id="move-now-btn" class="start-button" ${!gameInProgress ? 'style="visibility: hidden;"' : ''} disabled title="Play the best move found so far">Move now</button>` : ''}
        ${
          isSetupMode
            ? '<button id="clear-board-btn" class="reset-button">Clear Board</button>'
            : `<button id="reset-btn" class="reset-button" ${!gameInProgress ? 'style="visibility: hidden;"' : ''}>New Game</button>`
        }
      </div>
      <div id="game-board" class="board"></div>
    </div>
  `;

    // Add event listeners based on mode
    if (!isSetupMode) {
      document.getElementById('reset-btn').addEventListener('click', initGame);
      document
        .getElementById('move-now-btn')
        .addEventListener('click', forceComputerMove);
      document.getElementById('start-btn').addEventListener('click', startGame);
      document
        .getElementById('setup-btn')
        .addEventListener('click', enterSetupMode);
      document
        .getElementById('player-color')
        .addEventListener('change', (e) => {
          setHumanPlayer(e.target.value);
        });
      document
        .getElementById('ai-difficulty')
        .addEventListener('change', (e) => {
          setDifficulty(e.target.value);
        });
      document
        .getElementById('use-policy')
        .addEventListener('change', (e) => {
          setUsePolicy(e.target.checked);
        });
    } else {
      document
        .getElementById('clear-board-btn')
        .addEventListener('click', clearSetupBoard);
      document
        .getElementById('setup-start-btn')
        .addEventListener('click', startGameFromSetup);
      document
        .getElementById('setup-cancel-btn')
        .addEventListener('click', exitSetupMode);
      document
        .getElementById('setup-computer-color')
        .addEventListener('change', (e) => {
          Setup.setSetupComputerColor(e.target.value);
        });
      document
        .getElementById('setup-next-move')
        .addEventListener('change', (e) => {
          Setup.setSetupNextMove(e.target.value);
        });
    }
  }

  function createBoard() {
    const { board, currentPlayer, humanPlayer, aiDifficulty, gameInProgress } =
      getState();
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

  function highlightWinningStones(positions) {
    const { board, currentPlayer, humanPlayer, aiDifficulty, gameInProgress } =
      getState();
    positions.forEach(([row, col]) => {
      const cell = document.querySelector(
        `[data-row="${row}"][data-col="${col}"]`,
      );
      if (cell) {
        cell.classList.add('winning-stone');
      }
    });
  }

  function updateGameStatus(message = null) {
    const { board, currentPlayer, humanPlayer, aiDifficulty, gameInProgress } =
      getState();
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
    const { board, currentPlayer, humanPlayer, aiDifficulty, gameInProgress } =
      getState();
    const progressFill = document.getElementById('ai-progress');
    if (progressFill) {
      progressFill.style.width = `${Math.min(100, Math.max(0, progress))}%`;

      // Remove animation when near completion
      if (progress >= 95) {
        progressFill.classList.remove('animated');
      }
    }
  }

  function updateBoardDisplay() {
    const { board, currentPlayer, humanPlayer, aiDifficulty, gameInProgress } =
      getState();
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const cell = document.querySelector(
          `[data-row="${row}"][data-col="${col}"]`,
        );
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
  function disableBoard() {
    document.getElementById('game-board')?.classList.add('disabled');
  }
  function showPlayingControls() {
    document.getElementById('player-color').disabled = true;
    document.getElementById('ai-difficulty').disabled = true;
    document.getElementById('use-policy').disabled = true;
    document.getElementById('start-btn').style.visibility = 'hidden';
    document.getElementById('setup-btn').style.visibility = 'hidden';
    document.getElementById('reset-btn').style.visibility = 'visible';
    document.getElementById('move-now-btn').style.visibility = 'visible';
    document.getElementById('game-board').classList.remove('disabled');
  }
  function placeStone(row, col, color) {
    document.querySelector('.last-move')?.classList.remove('last-move');
    document
      .querySelector(`[data-row="${row}"][data-col="${col}"]`)
      .classList.add('stone', color, 'last-move');
  }
  function showSetupCell(row, col, color) {
    const cell = document.querySelector(
      `[data-row="${row}"][data-col="${col}"]`,
    );
    cell.classList.remove('stone', 'black', 'white');
    if (color) cell.classList.add('stone', color);
  }

  function setThinking(thinking) {
    const button = document.getElementById('move-now-btn');
    if (button) button.disabled = !thinking;
  }

  return {
    setThinking,
    createGameUI,
    createBoard,
    highlightWinningStones,
    updateGameStatus,
    updateAIProgress,
    updateBoardDisplay,
    disableBoard,
    showPlayingControls,
    placeStone,
    showSetupCell,
  };
}

import { getBoardResult } from '../core/rules.js';
export function createSetupState() {
  // Board Setup Module
  // Handles board setup mode functionality

  let setupMode = false;
  let setupBoard = [];
  let setupComputerColor = 'white';
  let setupNextMove = 'black';

  // Initialize setup board
  function initSetupBoard() {
    setupBoard = Array(15)
      .fill(null)
      .map(() => Array(15).fill(null));
  }

  // Enter setup mode
  function enterSetupMode() {
    setupMode = true;
    initSetupBoard();
    return {
      mode: setupMode,
      board: setupBoard,
      computerColor: setupComputerColor,
      nextMove: setupNextMove,
    };
  }

  // Exit setup mode
  function exitSetupMode() {
    setupMode = false;
    setupBoard = [];
    setupComputerColor = 'white';
    setupNextMove = 'black';
    return {
      mode: setupMode,
    };
  }

  // Check if in setup mode
  function isSetupMode() {
    return setupMode;
  }

  // Get current setup state
  function getSetupState() {
    return {
      mode: setupMode,
      board: setupBoard,
      computerColor: setupComputerColor,
      nextMove: setupNextMove,
    };
  }

  // Toggle cell state in setup mode (empty -> black -> white -> empty)
  function toggleSetupCell(row, col) {
    if (!setupMode) return null;

    const currentState = setupBoard[row][col];
    let newState;

    if (currentState === null) {
      newState = 'black';
    } else if (currentState === 'black') {
      newState = 'white';
    } else {
      newState = null;
    }

    setupBoard[row][col] = newState;
    return newState;
  }

  // Set computer color
  function setSetupComputerColor(color) {
    if (color === 'black' || color === 'white') {
      setupComputerColor = color;
    }
    return setupComputerColor;
  }

  // Set next move
  function setSetupNextMove(color) {
    if (color === 'black' || color === 'white') {
      setupNextMove = color;
    }
    return setupNextMove;
  }

  // Get setup board for game start
  function getSetupBoardForGame() {
    if (!setupMode) return null;

    return {
      board: setupBoard.map((row) => [...row]), // Deep copy
      computerColor: setupComputerColor,
      humanColor: setupComputerColor === 'black' ? 'white' : 'black',
      nextMove: setupNextMove,
    };
  }

  // Clear the setup board
  function clearSetupBoard() {
    if (setupMode) {
      initSetupBoard(); // Reset to empty board
    }
  }

  // Validate setup (optional - could add rules like valid board state)
  function validateSetup() {
    return setupMode && !getBoardResult(setupBoard)?.invalid;
  }

  return {
    initSetupBoard,
    enterSetupMode,
    exitSetupMode,
    isSetupMode,
    getSetupState,
    toggleSetupCell,
    setSetupComputerColor,
    setSetupNextMove,
    getSetupBoardForGame,
    clearSetupBoard,
    validateSetup,
  };
}

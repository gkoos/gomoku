// Board Setup Module
// Handles board setup mode functionality

let setupMode = false;
let setupBoard = [];
let setupComputerColor = 'white';
let setupNextMove = 'black';

// Initialize setup board
export function initSetupBoard() {
  setupBoard = Array(15).fill(null).map(() => Array(15).fill(null));
}

// Enter setup mode
export function enterSetupMode() {
  setupMode = true;
  initSetupBoard();
  return {
    mode: setupMode,
    board: setupBoard,
    computerColor: setupComputerColor,
    nextMove: setupNextMove
  };
}

// Exit setup mode
export function exitSetupMode() {
  setupMode = false;
  setupBoard = [];
  setupComputerColor = 'white';
  setupNextMove = 'black';
  return {
    mode: setupMode
  };
}

// Check if in setup mode
export function isSetupMode() {
  return setupMode;
}

// Get current setup state
export function getSetupState() {
  return {
    mode: setupMode,
    board: setupBoard,
    computerColor: setupComputerColor,
    nextMove: setupNextMove
  };
}

// Toggle cell state in setup mode (empty -> black -> white -> empty)
export function toggleSetupCell(row, col) {
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
export function setSetupComputerColor(color) {
  if (color === 'black' || color === 'white') {
    setupComputerColor = color;
  }
  return setupComputerColor;
}

// Set next move
export function setSetupNextMove(color) {
  if (color === 'black' || color === 'white') {
    setupNextMove = color;
  }
  return setupNextMove;
}

// Get setup board for game start
export function getSetupBoardForGame() {
  if (!setupMode) return null;
  
  return {
    board: setupBoard.map(row => [...row]), // Deep copy
    computerColor: setupComputerColor,
    humanColor: setupComputerColor === 'black' ? 'white' : 'black',
    nextMove: setupNextMove
  };
}

// Clear the setup board
export function clearSetupBoard() {
  if (setupMode) {
    initSetupBoard(); // Reset to empty board
  }
}

// Validate setup (optional - could add rules like valid board state)
export function validateSetup() {
  // For now, any setup is valid
  // Could add checks like:
  // - No more than 1 stone difference between black and white
  // - No winning positions already on board
  return true;
}

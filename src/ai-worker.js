// AI Worker - Self-contained version that works in both dev and production
// All dependencies are included inline to avoid import issues

// Constants
const BOARD_SIZE = 15;
const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;
const BITBOARD_SLOTS = 8;

// Simple win condition checker for bitboards
function checkWinCondition(bitboard, lastPosition) {
  const row = Math.floor(lastPosition / BOARD_SIZE);
  const col = lastPosition % BOARD_SIZE;

  const directions = [
    [0, 1],   // horizontal
    [1, 0],   // vertical
    [1, 1],   // diagonal \
    [1, -1]   // diagonal /
  ];

  for (const [dRow, dCol] of directions) {
    let count = 1; // Count the stone we just placed

    // Check in positive direction
    for (let i = 1; i < 5; i++) {
      const newRow = row + dRow * i;
      const newCol = col + dCol * i;

      if (newRow < 0 || newRow >= BOARD_SIZE || newCol < 0 || newCol >= BOARD_SIZE) break;

      const pos = newRow * BOARD_SIZE + newCol;
      const slot = Math.floor(pos / 32);
      const bit = pos % 32;

      if (slot < 8 && ((bitboard[slot] >>> 0) & (1 << bit)) !== 0) {
        count++;
      } else {
        break;
      }
    }

    // Check in negative direction
    for (let i = 1; i < 5; i++) {
      const newRow = row - dRow * i;
      const newCol = col - dCol * i;

      if (newRow < 0 || newRow >= BOARD_SIZE || newCol < 0 || newCol >= BOARD_SIZE) break;

      const pos = newRow * BOARD_SIZE + newCol;
      const slot = Math.floor(pos / 32);
      const bit = pos % 32;

      if (slot < 8 && ((bitboard[slot] >>> 0) & (1 << bit)) !== 0) {
        count++;
      } else {
        break;
      }
    }

    if (count >= 5) {
      return true;
    }
  }

  return false;
}

// Check for immediate threats (4 in a row with open ends)
function checkImmediateThreat(blackBitboard, whiteBitboard, playerColor) {
  const threatMoves = [];
  const targetBitboard = playerColor === "black" ? blackBitboard : whiteBitboard;

  // Check each empty position on the board
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const position = row * BOARD_SIZE + col;
      const slot = Math.floor(position / 32);
      const bit = position % 32;

      if (slot >= 8) continue;

      // Skip if position is occupied
      const blackBit = ((blackBitboard[slot] >>> 0) & (1 << bit)) !== 0;
      const whiteBit = ((whiteBitboard[slot] >>> 0) & (1 << bit)) !== 0;
      if (blackBit || whiteBit) continue;

      // Test placing a stone here for the target player
      const testBitboard = [...targetBitboard];
      testBitboard[slot] |= 1 << bit;

      // Check if this would create a win (5 in a row)
      if (checkWinCondition(testBitboard, position)) {
        // This position completes a 5-in-a-row
        threatMoves.push({ row, col, position, priority: 'win' });
      }
    }
  }

  return threatMoves;
}

// Check for open 4 patterns that need immediate blocking
function checkOpen4Threats(blackBitboard, whiteBitboard, playerColor) {
  const threatMoves = [];
  const targetBitboard = playerColor === "black" ? blackBitboard : whiteBitboard;
  
  const directions = [
    [0, 1],   // horizontal
    [1, 0],   // vertical
    [1, 1],   // diagonal \
    [1, -1]   // diagonal /
  ];

  // Check each empty position on the board
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const position = row * BOARD_SIZE + col;
      const slot = Math.floor(position / 32);
      const bit = position % 32;

      if (slot >= 8) continue;

      // Skip if position is occupied
      const blackBit = ((blackBitboard[slot] >>> 0) & (1 << bit)) !== 0;
      const whiteBit = ((whiteBitboard[slot] >>> 0) & (1 << bit)) !== 0;
      if (blackBit || whiteBit) continue;

      // Check each direction for open 4 patterns
      for (const [dRow, dCol] of directions) {
        if (hasOpen4PatternSimple(targetBitboard, blackBitboard, whiteBitboard, row, col, dRow, dCol)) {
          threatMoves.push({ row, col, position, priority: 'open4' });
          break; // Found a threat, no need to check other directions
        }
      }
    }
  }

  return threatMoves;
}

// Simplified check for open 4 pattern 
function hasOpen4PatternSimple(playerBitboard, blackBitboard, whiteBitboard, row, col, dRow, dCol) {
  // Helper function to check if position is empty
  const isEmpty = (r, c) => {
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return false;
    const pos = r * BOARD_SIZE + c;
    const slot = Math.floor(pos / 32);
    const bit = pos % 32;
    if (slot >= 8) return false;
    
    const blackBit = ((blackBitboard[slot] >>> 0) & (1 << bit)) !== 0;
    const whiteBit = ((whiteBitboard[slot] >>> 0) & (1 << bit)) !== 0;
    return !blackBit && !whiteBit;
  };
  
  // Test placing a stone at this position
  const testBitboard = [...playerBitboard];
  const position = row * BOARD_SIZE + col;
  const slot = Math.floor(position / 32);
  const bit = position % 32;
  testBitboard[slot] |= 1 << bit;
  
  // Count consecutive stones in both directions from the placed stone
  let count = 1; // The stone we just placed
  let positiveCount = 0;
  let negativeCount = 0;
  
  // Count in positive direction
  for (let i = 1; i < 5; i++) {
    const newRow = row + dRow * i;
    const newCol = col + dCol * i;
    
    if (newRow < 0 || newRow >= BOARD_SIZE || newCol < 0 || newCol >= BOARD_SIZE) break;
    
    const pos = newRow * BOARD_SIZE + newCol;
    const newSlot = Math.floor(pos / 32);
    const newBit = pos % 32;
    
    if (newSlot < 8 && ((testBitboard[newSlot] >>> 0) & (1 << newBit)) !== 0) {
      count++;
      positiveCount++;
    } else {
      break;
    }
  }
  
  // Count in negative direction
  for (let i = 1; i < 5; i++) {
    const newRow = row - dRow * i;
    const newCol = col - dCol * i;
    
    if (newRow < 0 || newRow >= BOARD_SIZE || newCol < 0 || newCol >= BOARD_SIZE) break;
    
    const pos = newRow * BOARD_SIZE + newCol;
    const newSlot = Math.floor(pos / 32);
    const newBit = pos % 32;
    
    if (newSlot < 8 && ((testBitboard[newSlot] >>> 0) & (1 << newBit)) !== 0) {
      count++;
      negativeCount++;
    } else {
      break;
    }
  }
  
  // If we have 4 or more consecutive stones, check if it's truly "open"
  if (count >= 4) {
    // For an "open 4", we need at least one end to be extendable to create 5-in-a-row
    // Check the positions immediately beyond our consecutive stones
    const positiveEnd = row + dRow * (positiveCount + 1);
    const positiveEndCol = col + dCol * (positiveCount + 1);
    const negativeEnd = row - dRow * (negativeCount + 1);
    const negativeEndCol = col - dCol * (negativeCount + 1);
    
    const positiveEndOpen = isEmpty(positiveEnd, positiveEndCol);
    const negativeEndOpen = isEmpty(negativeEnd, negativeEndCol);
    
    // Only consider this an "open 4" if at least one end can be extended
    // AND we have exactly 4 stones (not 5, which would be a win)
    return (positiveEndOpen || negativeEndOpen) && count === 4;
  }
  
  return false;
}

// Ultra-simple threat detection - MORE CONSERVATIVE for complex positions
function findSimple4Threats(blackBitboard, whiteBitboard, humanPlayer) {
  const threats = [];
  const humanBitboard = humanPlayer === "black" ? blackBitboard : whiteBitboard;
  const opponentBitboard = humanPlayer === "black" ? whiteBitboard : blackBitboard;
  
  // Count total stones to determine position complexity
  let totalStones = 0;
  for (let slot = 0; slot < 8; slot++) {
    const blackMask = blackBitboard[slot] >>> 0;
    const whiteMask = whiteBitboard[slot] >>> 0;
    const combinedMask = blackMask | whiteMask;
    
    // Count set bits in this slot
    let count = 0;
    for (let bit = 0; bit < 32; bit++) {
      if ((combinedMask & (1 << bit)) !== 0) {
        count++;
      }
    }
    totalStones += count;
  }
  
  const isComplexPosition = totalStones >= 10;
  
  // Helper function to check if a position has a human stone
  const hasHumanStone = (r, c) => {
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return false;
    const pos = r * BOARD_SIZE + c;
    const slot = Math.floor(pos / 32);
    const bit = pos % 32;
    return slot < 8 && ((humanBitboard[slot] >>> 0) & (1 << bit)) !== 0;
  };

  // Helper function to check if a position has an opponent stone
  const hasOpponentStone = (r, c) => {
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return false;
    const pos = r * BOARD_SIZE + c;
    const slot = Math.floor(pos / 32);
    const bit = pos % 32;
    return slot < 8 && ((opponentBitboard[slot] >>> 0) & (1 << bit)) !== 0;
  };
  
  // Helper function to check if a position is empty
  const isEmpty = (r, c) => {
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return false;
    const pos = r * BOARD_SIZE + c;
    const slot = Math.floor(pos / 32);
    const bit = pos % 32;
    const blackBit = ((blackBitboard[slot] >>> 0) & (1 << bit)) !== 0;
    const whiteBit = ((whiteBitboard[slot] >>> 0) & (1 << bit)) !== 0;
    return !blackBit && !whiteBit;
  };

  // Helper function to check if a position is blocked (opponent stone or board edge)
  const isBlocked = (r, c) => {
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return true; // Board edge
    return hasOpponentStone(r, c); // Opponent stone
  };
  
  // Check every empty position for 4-stone threat patterns
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (!isEmpty(row, col)) continue;
      
      // Check all 4 directions for potential 4-in-a-row completion
      const directions = [[0,1], [1,0], [1,1], [1,-1]];
      
      for (const [dRow, dCol] of directions) {
        // MUCH MORE CONSERVATIVE: Only look for immediate 4-in-a-row completions
        // Check if placing a stone here creates exactly 4 consecutive stones
        // and that pattern can be extended to 5
        
        let consecutiveStones = 1; // The stone we're placing
        let canExtendTo5 = false;
        
        // Count consecutive stones in positive direction
        let posCount = 0;
        for (let i = 1; i <= 4; i++) {
          if (hasHumanStone(row + dRow * i, col + dCol * i)) {
            posCount++;
            consecutiveStones++;
          } else {
            // Check if this position can be used to extend to 5
            if (i === posCount + 1 && isEmpty(row + dRow * i, col + dCol * i)) {
              canExtendTo5 = true;
            }
            break;
          }
        }
        
        // Count consecutive stones in negative direction
        let negCount = 0;
        for (let i = 1; i <= 4; i++) {
          if (hasHumanStone(row - dRow * i, col - dCol * i)) {
            negCount++;
            consecutiveStones++;
          } else {
            // Check if this position can be used to extend to 5
            if (i === negCount + 1 && isEmpty(row - dRow * i, col - dCol * i)) {
              canExtendTo5 = true;
            }
            break;
          }
        }
        
        // Only consider this a threat if:
        // 1. It creates exactly 4 or more consecutive stones
        // 2. The pattern can be extended to create 5-in-a-row
        // 3. It's not completely blocked on both ends
        if (consecutiveStones >= 4 && canExtendTo5) {
          // Additional verification: make sure we're not just filling a gap in a blocked pattern
          const leftmostPos = row - dRow * negCount;
          const leftmostCol = col - dCol * negCount;
          const rightmostPos = row + dRow * posCount;
          const rightmostCol = col + dCol * posCount;
          
          // Check that at least one end of the complete pattern is not blocked
          const leftEnd = leftmostPos - dRow;
          const leftEndCol = leftmostCol - dCol;
          const rightEnd = rightmostPos + dRow;
          const rightEndCol = rightmostCol + dCol;
          
          const leftEndBlocked = isBlocked(leftEnd, leftEndCol);
          const rightEndBlocked = isBlocked(rightEnd, rightEndCol);
          
          // Only add threat if at least one end is not blocked
          if (!leftEndBlocked || !rightEndBlocked) {
            threats.push({ row, col });
            break; // Found a threat in this direction, no need to check others
          }
        }
      }
    }
  }
  
  return threats;
}

// Simple open 3 threat detection - MORE CONSERVATIVE for complex positions
function checkSimpleOpen3Threats(blackBitboard, whiteBitboard, playerColor) {
  const threats = [];
  const playerBitboard = playerColor === "black" ? blackBitboard : whiteBitboard;
  
  // Helper to check if position has player's stone
  const hasPlayerStone = (r, c) => {
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return false;
    const pos = r * BOARD_SIZE + c;
    const slot = Math.floor(pos / 32);
    const bit = pos % 32;
    return slot < 8 && ((playerBitboard[slot] >>> 0) & (1 << bit)) !== 0;
  };
  
  // Helper to check if position is empty
  const isEmpty = (r, c) => {
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return false;
    const pos = r * BOARD_SIZE + c;
    const slot = Math.floor(pos / 32);
    const bit = pos % 32;
    const blackBit = ((blackBitboard[slot] >>> 0) & (1 << bit)) !== 0;
    const whiteBit = ((whiteBitboard[slot] >>> 0) & (1 << bit)) !== 0;
    return !blackBit && !whiteBit;
  };
  
  // Count total stones to determine if we should be more conservative
  let totalStones = 0;
  for (let slot = 0; slot < 8; slot++) {
    const blackMask = blackBitboard[slot] >>> 0;
    const whiteMask = whiteBitboard[slot] >>> 0;
    const combinedMask = blackMask | whiteMask;
    
    // Count set bits in this slot
    let count = 0;
    for (let bit = 0; bit < 32; bit++) {
      if ((combinedMask & (1 << bit)) !== 0) {
        count++;
      }
    }
    totalStones += count;
  }
  
  // If there are many stones on the board (complex position), 
  // be more conservative about open 3 detection to allow deep search
  const isComplexPosition = totalStones >= 12;
  
  // Check every empty position for open 3 patterns
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (!isEmpty(row, col)) continue;
      
      const directions = [[0,1], [1,0], [1,1], [1,-1]];
      
      for (const [dRow, dCol] of directions) {
        // Check for ONLY truly open 3 patterns that are immediately dangerous
        let foundCriticalOpen3 = false;
        
        // Only consider PERFECT open 3 patterns: _XXX_ (both ends open)
        if (isEmpty(row - dRow, col - dCol) &&
            hasPlayerStone(row + dRow, col + dCol) &&
            hasPlayerStone(row + dRow * 2, col + dCol * 2) &&
            hasPlayerStone(row + dRow * 3, col + dCol * 3) &&
            isEmpty(row + dRow * 4, col + dCol * 4)) {
          foundCriticalOpen3 = true;
        }
        
        // In complex positions, only react to the most critical threats
        if (foundCriticalOpen3) {
          // In complex positions, verify this is truly urgent
          if (isComplexPosition) {
            // Additional check: ensure this creates an immediate threat
            // (i.e., opponent can win in next few moves if not blocked)
            let urgencyScore = 0;
            
            // Check if there are multiple threats nearby
            let nearbyThreats = 0;
            for (let checkRow = Math.max(0, row - 3); checkRow <= Math.min(BOARD_SIZE - 1, row + 3); checkRow++) {
              for (let checkCol = Math.max(0, col - 3); checkCol <= Math.min(BOARD_SIZE - 1, col + 3); checkCol++) {
                if (hasPlayerStone(checkRow, checkCol)) {
                  nearbyThreats++;
                }
              }
            }
            
            urgencyScore += nearbyThreats;
            
            // Only add if urgency is high enough in complex positions
            if (urgencyScore >= 3) {
              threats.push({ row, col });
              break;
            }
          } else {
            // In simple positions, add all open 3s
            threats.push({ row, col });
            break;
          }
        }
      }
    }
  }

  return threats;
}

// Check for moves that create two open 3's (fork/double threat)
function checkDoubleOpen3Threats(blackBitboard, whiteBitboard, playerColor) {
  // Simplified version - just return empty array for now
  return [];
}

// Generate candidate moves near existing stones with smart ordering
function generateCandidateMoves(blackBitboard, whiteBitboard) {
  const candidates = [];
  const visited = new Set();
  const stonePositions = [];
  
  // Helper function to check if position is empty
  const isEmpty = (row, col) => {
    if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return false;
    const pos = row * BOARD_SIZE + col;
    const slot = Math.floor(pos / 32);
    const bit = pos % 32;
    const blackBit = ((blackBitboard[slot] >>> 0) & (1 << bit)) !== 0;
    const whiteBit = ((whiteBitboard[slot] >>> 0) & (1 << bit)) !== 0;
    return !blackBit && !whiteBit;
  };
  
  // Helper function to add candidate with priority score
  const addCandidate = (row, col, priority = 0) => {
    if (row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE && isEmpty(row, col)) {
      const key = `${row},${col}`;
      if (!visited.has(key)) {
        visited.add(key);
        candidates.push({ 
          row, 
          col, 
          position: row * BOARD_SIZE + col,
          priority: priority
        });
      }
    }
  };
  
  // First pass: collect all stone positions efficiently
  for (let slot = 0; slot < 8; slot++) {
    const blackMask = blackBitboard[slot] >>> 0;
    const whiteMask = whiteBitboard[slot] >>> 0;
    const combinedMask = blackMask | whiteMask;
    
    if (combinedMask === 0) continue; // Skip empty slots
    
    for (let bit = 0; bit < 32; bit++) {
      if ((combinedMask & (1 << bit)) !== 0) {
        const position = slot * 32 + bit;
        if (position >= BOARD_CELLS) break;
        
        const row = Math.floor(position / BOARD_SIZE);
        const col = position % BOARD_SIZE;
        stonePositions.push({ row, col });
      }
    }
  }
  
  // If no stones on board, start from center with high priority
  if (stonePositions.length === 0) {
    addCandidate(7, 7, 1000); // Center of 15x15 board
    addCandidate(6, 6, 900);
    addCandidate(6, 7, 950);
    addCandidate(6, 8, 900);
    addCandidate(7, 6, 950);
    addCandidate(7, 8, 950);
    addCandidate(8, 6, 900);
    addCandidate(8, 7, 950);
    addCandidate(8, 8, 900);
    return candidates.sort((a, b) => b.priority - a.priority);
  }
  
  // Generate candidates around stones with smart distance and density scoring
  for (const stone of stonePositions) {
    const { row, col } = stone;
    
    // Immediate adjacency (distance 1) - highest priority
    for (let dRow = -1; dRow <= 1; dRow++) {
      for (let dCol = -1; dCol <= 1; dCol++) {
        if (dRow === 0 && dCol === 0) continue;
        
        const newRow = row + dRow;
        const newCol = col + dCol;
        
        // Calculate density bonus (number of stones within distance 2)
        let density = 0;
        for (const otherStone of stonePositions) {
          const dist = Math.max(Math.abs(otherStone.row - newRow), Math.abs(otherStone.col - newCol));
          if (dist <= 2) density++;
        }
        
        // Priority: higher for denser areas and center positions
        const centerBonus = 14 - (Math.abs(newRow - 7) + Math.abs(newCol - 7));
        const priority = 100 + density * 20 + centerBonus;
        
        addCandidate(newRow, newCol, priority);
      }
    }
    
    // Extended range (distance 2) - lower priority, only in dense areas
    let localDensity = 0;
    for (const otherStone of stonePositions) {
      const dist = Math.max(Math.abs(otherStone.row - row), Math.abs(otherStone.col - col));
      if (dist <= 2) localDensity++;
    }
    
    // Only add distance-2 candidates in areas with sufficient stone density
    if (localDensity >= 3) {
      for (let dRow = -2; dRow <= 2; dRow++) {
        for (let dCol = -2; dCol <= 2; dCol++) {
          if (Math.abs(dRow) <= 1 && Math.abs(dCol) <= 1) continue; // Skip already added
          if (dRow === 0 && dCol === 0) continue;
          
          const newRow = row + dRow;
          const newCol = col + dCol;
          
          // Lower priority for distance-2 moves
          const centerBonus = 14 - (Math.abs(newRow - 7) + Math.abs(newCol - 7));
          const priority = 30 + localDensity * 5 + centerBonus;
          
          addCandidate(newRow, newCol, priority);
        }
      }
    }
  }
  
  // Sort candidates by priority (highest first) and limit to reasonable number
  candidates.sort((a, b) => b.priority - a.priority);
  
  // Limit candidates to prevent excessive search in complex positions
  const maxCandidates = Math.min(candidates.length, stonePositions.length < 10 ? 30 : 50); // Increased limits
  return candidates.slice(0, maxCandidates);
}

// Simple evaluation function with enhanced strategy and caching
function findBestMoveAdaptive(blackBitboard, whiteBitboard, computerPlayer, humanPlayer, difficulty, progressCallback) {
  if (progressCallback) progressCallback(10);
  
  // For hard difficulty, use deep minimax search with 8-ply
  if (difficulty === 'hard') {
    const deepMove = findBestMoveDeepSearch(
      blackBitboard, 
      whiteBitboard, 
      computerPlayer, 
      humanPlayer, 
      (progress) => {
        if (progressCallback) {
          const mappedProgress = 10 + (progress / 100) * 80;
          progressCallback(Math.floor(mappedProgress));
        }
      },
      8 // 8-ply depth for hard
    );
    
    if (deepMove) {
      if (progressCallback) progressCallback(100);
      return deepMove;
    }
    // Fallback to regular search if deep search fails
  }
  
  // For medium difficulty, use deep minimax search with 6-ply
  if (difficulty === 'medium') {
    const deepMove = findBestMoveDeepSearch(
      blackBitboard, 
      whiteBitboard, 
      computerPlayer, 
      humanPlayer, 
      (progress) => {
        if (progressCallback) {
          const mappedProgress = 10 + (progress / 100) * 80;
          progressCallback(Math.floor(mappedProgress));
        }
      },
      6 // 6-ply depth for medium
    );
    
    if (deepMove) {
      if (progressCallback) progressCallback(100);
      return deepMove;
    }
    // Fallback to regular search if deep search fails
  }
  
  const candidates = generateCandidateMoves(blackBitboard, whiteBitboard);
  if (candidates.length === 0) {
    return { row: 7, col: 7 };
  }
  
  if (progressCallback) progressCallback(30);
  
  // Score each candidate move with enhanced evaluation
  let bestMove = null;
  let bestScore = -Infinity;
  const moveScores = [];
  
  // Evaluate all candidates
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const score = evaluateMoveEnhanced(blackBitboard, whiteBitboard, candidate, computerPlayer, humanPlayer);
    
    moveScores.push({ candidate, score });
    
    if (score > bestScore) {
      bestScore = score;
      bestMove = candidate;
    }
    
    // Update progress
    if (progressCallback && i % 5 === 0) {
      const progress = 30 + (i / candidates.length) * 60;
      progressCallback(Math.floor(progress));
    }
  }
  
  // For medium difficulty, consider multiple top moves
  if (difficulty === 'medium' && moveScores.length > 1) {
    // Sort by score and consider top moves
    moveScores.sort((a, b) => b.score - a.score);
    
    // If there are multiple moves with similar high scores, add strategic considerations
    const topScore = moveScores[0].score;
    const topMoves = moveScores.filter(m => m.score >= topScore * 0.9);
    
    if (topMoves.length > 1) {
      // Among top moves, prefer those with better position characteristics
      let bestStrategicMove = topMoves[0];
      let bestStrategicScore = -Infinity;
      
      for (const move of topMoves) {
        const strategicScore = evaluateStrategicPosition(blackBitboard, whiteBitboard, move.candidate, computerPlayer);
        if (strategicScore > bestStrategicScore) {
          bestStrategicScore = strategicScore;
          bestStrategicMove = move;
        }
      }
      
      bestMove = bestStrategicMove.candidate;
    }
  }
  
  if (progressCallback) progressCallback(100);
  return bestMove || candidates[0];
}

// Enhanced move evaluation with pattern recognition and threat assessment
function evaluateMoveEnhanced(blackBitboard, whiteBitboard, move, computerPlayer, humanPlayer) {
  const { row, col } = move;
  let score = 0;
  
  // Start with candidate priority bonus
  score += (move.priority || 0) * 0.1;
  
  // Create test bitboards with the move played
  const computerBitboard = computerPlayer === "black" ? blackBitboard : whiteBitboard;
  const opponentBitboard = computerPlayer === "black" ? whiteBitboard : blackBitboard;
  const testComputerBitboard = [...computerBitboard];
  const position = row * BOARD_SIZE + col;
  const slot = Math.floor(position / 32);
  const bit = position % 32;
  testComputerBitboard[slot] |= 1 << bit;
  
  // Evaluate patterns in all directions
  const directions = [[0,1], [1,0], [1,1], [1,-1]];
  let maxLineScore = 0;
  let totalLineScore = 0;
  
  for (const [dRow, dCol] of directions) {
    const lineScore = evaluateLineEnhanced(testComputerBitboard, opponentBitboard, row, col, dRow, dCol);
    maxLineScore = Math.max(maxLineScore, lineScore);
    totalLineScore += lineScore;
  }
  
  // Weight both the best line and total potential
  score += maxLineScore * 2 + totalLineScore * 0.5;
  
  // Defensive evaluation - check what opponent threats this move blocks
  const testOpponentBitboard = [...opponentBitboard];
  testOpponentBitboard[slot] |= 1 << bit; // Temporarily place opponent stone
  
  let blockedThreats = 0;
  for (const [dRow, dCol] of directions) {
    const opponentLineScore = evaluateLineEnhanced(testOpponentBitboard, computerBitboard, row, col, dRow, dCol);
    if (opponentLineScore >= 1000) blockedThreats += opponentLineScore * 0.8; // Blocking bonus
  }
  score += blockedThreats;
  
  // Position quality bonuses
  score += evaluatePositionQuality(row, col, blackBitboard, whiteBitboard);
  
  return score;
}

// Enhanced line evaluation with better pattern recognition
function evaluateLineEnhanced(playerBitboard, opponentBitboard, row, col, dRow, dCol) {
  let playerStones = 1; // The stone we just placed
  let spaces = 0;
  let openEnds = 0;
  let blocked = false;
  
  // Analyze in positive direction
  let consecutiveStones = 0;
  for (let i = 1; i <= 5; i++) {
    const newRow = row + dRow * i;
    const newCol = col + dCol * i;
    
    if (newRow < 0 || newRow >= BOARD_SIZE || newCol < 0 || newCol >= BOARD_SIZE) {
      blocked = true;
      break;
    }
    
    const pos = newRow * BOARD_SIZE + newCol;
    const slot = Math.floor(pos / 32);
    const bit = pos % 32;
    
    if (slot < 8 && ((playerBitboard[slot] >>> 0) & (1 << bit)) !== 0) {
      consecutiveStones++;
      playerStones++;
    } else if (slot < 8 && ((opponentBitboard[slot] >>> 0) & (1 << bit)) !== 0) {
      blocked = true;
      break;
    } else {
      // Empty space
      if (consecutiveStones > 0 || i === 1) {
        spaces++;
        if (i <= 4) openEnds++; // Only count as open end if within 5-stone range
      }
      break;
    }
  }
  
  // Reset for negative direction
  consecutiveStones = 0;
  let negBlocked = false;
  
  for (let i = 1; i <= 5; i++) {
    const newRow = row - dRow * i;
    const newCol = col - dCol * i;
    
    if (newRow < 0 || newRow >= BOARD_SIZE || newCol < 0 || newCol >= BOARD_SIZE) {
      negBlocked = true;
      break;
    }
    
    const pos = newRow * BOARD_SIZE + newCol;
    const slot = Math.floor(pos / 32);
    const bit = pos % 32;
    
    if (slot < 8 && ((playerBitboard[slot] >>> 0) & (1 << bit)) !== 0) {
      consecutiveStones++;
      playerStones++;
    } else if (slot < 8 && ((opponentBitboard[slot] >>> 0) & (1 << bit)) !== 0) {
      negBlocked = true;
      break;
    } else {
      // Empty space
      if (consecutiveStones > 0 || i === 1) {
        spaces++;
        if (i <= 4) openEnds++; // Only count as open end if within 5-stone range
      }
      break;
    }
  }
  
  // Adjust open ends based on blocking
  if (blocked && negBlocked) openEnds = 0;
  else if (blocked || negBlocked) openEnds = Math.min(openEnds, 1);
  else openEnds = Math.min(openEnds, 2);
  
  // Enhanced scoring based on pattern strength
  if (playerStones >= 5) return 100000; // Win
  if (playerStones === 4) {
    if (openEnds >= 1) return 10000; // Open or semi-open 4
    return 1000; // Closed 4
  }
  if (playerStones === 3) {
    if (openEnds >= 2) return 2000; // Open 3 (very strong)
    if (openEnds >= 1) return 500; // Semi-open 3
    return 100; // Closed 3
  }
  if (playerStones === 2) {
    if (openEnds >= 2) return 200; // Open 2
    if (openEnds >= 1) return 80; // Semi-open 2
    return 20; // Closed 2
  }
  
  return playerStones * 10 + spaces * 2; // Basic score
}

// Evaluate strategic position characteristics
function evaluateStrategicPosition(blackBitboard, whiteBitboard, move, computerPlayer) {
  const { row, col } = move;
  let score = 0;
  
  // Center control bonus
  const centerDist = Math.abs(row - 7) + Math.abs(col - 7);
  score += (14 - centerDist) * 3;
  
  // Connectivity bonus - prefer positions that connect to existing stones
  let connectivity = 0;
  const computerBitboard = computerPlayer === "black" ? blackBitboard : whiteBitboard;
  
  for (let dRow = -2; dRow <= 2; dRow++) {
    for (let dCol = -2; dCol <= 2; dCol++) {
      if (dRow === 0 && dCol === 0) continue;
      
      const newRow = row + dRow;
      const newCol = col + dCol;
      
      if (newRow >= 0 && newRow < BOARD_SIZE && newCol >= 0 && newCol < BOARD_SIZE) {
        const pos = newRow * BOARD_SIZE + newCol;
        const slot = Math.floor(pos / 32);
        const bit = pos % 32;
        
        if (slot < 8 && ((computerBitboard[slot] >>> 0) & (1 << bit)) !== 0) {
          const distance = Math.max(Math.abs(dRow), Math.abs(dCol));
          connectivity += distance === 1 ? 20 : distance === 2 ? 10 : 5;
        }
      }
    }
  }
  
  score += connectivity;
  
  // Flexibility bonus - positions that allow multiple future directions
  let flexibilityScore = 0;
  const directions = [[0,1], [1,0], [1,1], [1,-1]];
  
  for (const [dRow, dCol] of directions) {
    let spaceInDirection = 0;
    
    // Check both directions along this line
    for (let sign of [-1, 1]) {
      for (let i = 1; i <= 4; i++) {
        const newRow = row + dRow * i * sign;
        const newCol = col + dCol * i * sign;
        
        if (newRow >= 0 && newRow < BOARD_SIZE && newCol >= 0 && newCol < BOARD_SIZE) {
          const pos = newRow * BOARD_SIZE + newCol;
          const slot = Math.floor(pos / 32);
          const bit = pos % 32;
          
          if (slot < 8) {
            const blackBit = ((blackBitboard[slot] >>> 0) & (1 << bit)) !== 0;
            const whiteBit = ((whiteBitboard[slot] >>> 0) & (1 << bit)) !== 0;
            
            if (!blackBit && !whiteBit) {
              spaceInDirection++;
            } else {
              break; // Hit a stone
            }
          }
        } else {
          break; // Hit board edge
        }
      }
    }
    
    flexibilityScore += Math.min(spaceInDirection, 6) * 2;
  }
  
  score += flexibilityScore;
  
  return score;
}

// Evaluate general position quality
function evaluatePositionQuality(row, col, blackBitboard, whiteBitboard) {
  let score = 0;
  
  // Distance from center
  const centerDist = Math.abs(row - 7) + Math.abs(col - 7);
  score += (14 - centerDist) * 2;
  
  // Density in local area
  let localDensity = 0;
  for (let dRow = -2; dRow <= 2; dRow++) {
    for (let dCol = -2; dCol <= 2; dCol++) {
      if (dRow === 0 && dCol === 0) continue;
      
      const newRow = row + dRow;
      const newCol = col + dCol;
      
      if (newRow >= 0 && newRow < BOARD_SIZE && newCol >= 0 && newCol < BOARD_SIZE) {
        const pos = newRow * BOARD_SIZE + newCol;
        const slot = Math.floor(pos / 32);
        const bit = pos % 32;
        
        if (slot < 8) {
          const blackBit = ((blackBitboard[slot] >>> 0) & (1 << bit)) !== 0;
          const whiteBit = ((whiteBitboard[slot] >>> 0) & (1 << bit)) !== 0;
          if (blackBit || whiteBit) {
            localDensity++;
          }
        }
      }
    }
  }
  
  score += localDensity * 8;
  
  return score;
}

// Placeholder functions
function clearTranspositionTable() {}
function clearEvaluationCache() {}
function initZobristTable() {}

// Listen for messages from the main thread
self.addEventListener('message', async function (e) {
  try {
    const { type, data } = e.data;

    switch (type) {
      case "FIND_BEST_MOVE": {
        const { blackBitboard, whiteBitboard, computerPlayer, humanPlayer, difficulty } = data;

        // Debug: Check if bitboards are properly received
        if (!blackBitboard || !whiteBitboard) {
          self.postMessage({
            type: "BEST_MOVE_FOUND",
            move: null,
          });
          return;
        }

        // Use the AI logic
        try {
          const bestMove = await findBestMove(
            blackBitboard,
            whiteBitboard,
            computerPlayer,
            humanPlayer,
            difficulty
          );
          
          self.postMessage({
            type: "BEST_MOVE_FOUND",
            move: bestMove,
          });
        } catch (error) {
          self.postMessage({
            type: "BEST_MOVE_FOUND",
            move: { row: 7, col: 7 }, // Fallback center move
          });
        }
        break;
      }

      case "NEW_GAME":
        // Clear caches for new game
        if (typeof clearTranspositionTable === 'function') {
          clearTranspositionTable();
        }
        if (typeof clearEvaluationCache === 'function') {
          clearEvaluationCache();
        }
        break;

      default:
        break;
    }
  } catch (error) {
    console.error('AI Worker error:', error);
    self.postMessage({
      type: "BEST_MOVE_FOUND",
      move: { row: 7, col: 7 }, // Center fallback
    });
  }
});

// Progress callback function
function progressCallback(progress) {
  self.postMessage({
    type: "PROGRESS_UPDATE",
    progress: progress,
  });
}

// Main AI function - finds the best move for the computer
async function findBestMove(
  blackBitboard,
  whiteBitboard,
  computerPlayer,
  humanPlayer,
  difficulty
) {
  const startTime = performance.now();
  
  try {
    // Initialize Zobrist table if not already done
    if (typeof initZobristTable === 'function') {
      initZobristTable();
    }

    // OPTIMIZATION: If this is the first move of the game, just place in center
    let totalStones = 0;
    for (let slot = 0; slot < 8; slot++) {
      const blackMask = blackBitboard[slot] >>> 0;
      const whiteMask = whiteBitboard[slot] >>> 0;
      const combinedMask = blackMask | whiteMask;
      
      // Count set bits in this slot
      let count = 0;
      for (let bit = 0; bit < 32; bit++) {
        if ((combinedMask & (1 << bit)) !== 0) {
          count++;
        }
      }
      totalStones += count;
    }
    
    // If board is empty, place first move in center immediately
    if (totalStones === 0) {
      progressCallback(100);
      return { row: 7, col: 7 }; // Center of 15x15 board
    }
    
    // For hard difficulty in very complex positions, skip some threat checks and go straight to deep search
    const isVeryComplexPosition = totalStones >= 15; // Lowered from 20 to 15
    const skipEarlyReturnsForDeepSearch = difficulty === 'hard' && isVeryComplexPosition;
    
    // Report progress
    progressCallback(2);

    // PRIORITY 1: AI wins with 5-in-a-row (Five - XXXXX)
    const aiWinMoves = checkImmediateThreat(blackBitboard, whiteBitboard, computerPlayer);
    if (aiWinMoves.length > 0) {
      const winMove = aiWinMoves[0];
      progressCallback(100);
      return { row: winMove.row, col: winMove.col };
    }

    // PRIORITY 2: Block opponent's immediate winning threats (Five - XXXXX)
    progressCallback(4);
    const humanWinThreats = checkImmediateThreat(blackBitboard, whiteBitboard, humanPlayer);
    if (humanWinThreats.length > 0) {
      progressCallback(100);
      return { row: humanWinThreats[0].row, col: humanWinThreats[0].col };
    }

    // PRIORITY 3: AI's Open Four (_XXXX_)
    progressCallback(6);
    const aiOpen4Threats = checkOpen4Threats(blackBitboard, whiteBitboard, computerPlayer);
    if (aiOpen4Threats.length > 0) {
      const threat = aiOpen4Threats[0];
      progressCallback(100);
      return { row: threat.row, col: threat.col };
    }

    // PRIORITY 4: Block opponent's Open Four (_XXXX_)
    progressCallback(8);
    const humanOpen4s = checkOpen4Threats(blackBitboard, whiteBitboard, humanPlayer);
    if (humanOpen4s.length > 0) {
      const threat = humanOpen4s[0];
      progressCallback(100);
      return { row: threat.row, col: threat.col };
    }

    // PRIORITY 5: AI's Closed Four (XXXX_, etc.) - Skip in very complex positions for hard difficulty
    if (!skipEarlyReturnsForDeepSearch) {
      progressCallback(10);
      const aiClosed4Threats = findSimple4Threats(blackBitboard, whiteBitboard, computerPlayer);
      if (aiClosed4Threats.length > 0) {
        progressCallback(100);
        return aiClosed4Threats[0];
      }
    }

    // PRIORITY 6: Block opponent's Closed Four (XXXX_, etc.) - Skip in very complex positions for hard difficulty
    if (!skipEarlyReturnsForDeepSearch) {
      progressCallback(12);
      const humanClosed4Threats = findSimple4Threats(blackBitboard, whiteBitboard, humanPlayer);
      if (humanClosed4Threats.length > 0) {
        progressCallback(100);
        return humanClosed4Threats[0];
      }
    }

    // PRIORITY 7: AI's Double Three (2 × _XXX_)
    progressCallback(14);
    const aiDoubleOpen3s = checkDoubleOpen3Threats(blackBitboard, whiteBitboard, computerPlayer);
    if (aiDoubleOpen3s.length > 0) {
      const threat = aiDoubleOpen3s[0];
      progressCallback(100);
      return { row: threat.row, col: threat.col };
    }

    // PRIORITY 8: Block opponent's Double Three (2 × _XXX_)
    progressCallback(16);
    const opponentDoubleOpen3s = checkDoubleOpen3Threats(blackBitboard, whiteBitboard, humanPlayer);
    if (opponentDoubleOpen3s.length > 0) {
      const threat = opponentDoubleOpen3s[0];
      progressCallback(100);
      return { row: threat.row, col: threat.col };
    }

    // PRIORITY 9: AI's Open Three (_XXX_) - Skip in very complex positions for hard difficulty
    if (!skipEarlyReturnsForDeepSearch) {
      progressCallback(18);
      const aiOpen3s = checkSimpleOpen3Threats(blackBitboard, whiteBitboard, computerPlayer);
      if (aiOpen3s.length > 0) {
        const threat = aiOpen3s[0];
        progressCallback(100);
        return { row: threat.row, col: threat.col };
      }
    }

    // PRIORITY 10: Block opponent's Open Three (_XXX_) - Skip in very complex positions for hard difficulty
    if (!skipEarlyReturnsForDeepSearch) {
      progressCallback(20);
      const opponentOpen3s = checkSimpleOpen3Threats(blackBitboard, whiteBitboard, humanPlayer);
      if (opponentOpen3s.length > 0) {
        const threat = opponentOpen3s[0];
        
        // For hard difficulty in complex positions, consider deep search even when blocking threats
        if (difficulty === 'hard' && totalStones >= 10) {
          // Do a quick evaluation to see if the threat is truly urgent
          let threatUrgency = 0;
          
          // Check how many other threats exist
          const allThreats = [
            ...checkImmediateThreat(blackBitboard, whiteBitboard, humanPlayer),
            ...checkOpen4Threats(blackBitboard, whiteBitboard, humanPlayer),
            ...findSimple4Threats(blackBitboard, whiteBitboard, humanPlayer),
            ...opponentOpen3s
          ];
          
          threatUrgency = allThreats.length;
          
          // If there are multiple threats or this is a very complex position, use deep search
          if (threatUrgency <= 2 && totalStones >= 15) {
            // Fall through to deep search instead of immediate blocking
          } else {
            progressCallback(100);
            return { row: threat.row, col: threat.col };
          }
        } else {
          progressCallback(100);
          return { row: threat.row, col: threat.col };
        }
      }
    }

    // GENERAL DEEP SEARCH for remaining moves (difficulty-based depth)
    progressCallback(22);
    
    if (typeof findBestMoveAdaptive === 'function') {
      const bestMove = findBestMoveAdaptive(
        blackBitboard,
        whiteBitboard,
        computerPlayer,
        humanPlayer,
        difficulty,
        (progress) => {
          const mappedProgress = Math.min(95, 22 + (progress / 100) * 73);
          progressCallback(Math.floor(mappedProgress));
        }
      );
      
      if (bestMove) {
        progressCallback(100);
        return bestMove;
      }
    }
    
    // Fallback to candidate moves if everything else fails
    progressCallback(96);
    const availableMoves = generateCandidateMoves(blackBitboard, whiteBitboard);
    if (availableMoves.length > 0) {
      progressCallback(100);
      return { row: availableMoves[0].row, col: availableMoves[0].col };
    }
    
    // Ultimate fallback - center move
    progressCallback(100);
    return { row: 7, col: 7 };
    
  } catch (error) {
    console.error('AI Worker error in findBestMove:', error);
    // Emergency fallback
    progressCallback(100);
    return { row: 7, col: 7 };
  }
}

// Minimax with Alpha-Beta Pruning for deeper search (hard difficulty)
function minimaxAlphaBeta(blackBitboard, whiteBitboard, depth, alpha, beta, isMaximizing, computerPlayer, humanPlayer, moveHistory = [], progressTracker = null) {
  // Terminal conditions
  if (depth === 0) {
    const score = evaluatePosition(blackBitboard, whiteBitboard, computerPlayer, humanPlayer);
    return {
      score: score,
      move: null
    };
  }
  
  // Check for immediate wins/losses
  const computerBitboard = computerPlayer === "black" ? blackBitboard : whiteBitboard;
  const opponentBitboard = computerPlayer === "black" ? whiteBitboard : blackBitboard;
  
  // Check if game is already won
  if (moveHistory.length > 0) {
    const lastMove = moveHistory[moveHistory.length - 1];
    const lastPlayer = moveHistory.length % 2 === 1 ? computerPlayer : humanPlayer;
    const lastBitboard = lastPlayer === computerPlayer ? computerBitboard : opponentBitboard;
    
    if (checkWinCondition(lastBitboard, lastMove.row * BOARD_SIZE + lastMove.col)) {
      if (lastPlayer === computerPlayer) {
        return { score: 100000 - moveHistory.length, move: null }; // Prefer faster wins
      } else {
        return { score: -100000 + moveHistory.length, move: null }; // Delay losses
      }
    }
  }
  
  // Generate candidate moves (limited for performance)
  const candidates = generateCandidateMoves(blackBitboard, whiteBitboard);
  if (candidates.length === 0) {
    return { score: 0, move: null };
  }
  
  // Limit candidates based on depth to maintain performance
  const maxCandidates = Math.max(8, Math.floor(20 - depth * 2)); // Increased base candidates
  const limitedCandidates = candidates.slice(0, maxCandidates);
  
  if (isMaximizing) {
    let maxEval = -Infinity;
    let bestMove = null;
    
    for (let i = 0; i < limitedCandidates.length; i++) {
      const candidate = limitedCandidates[i];
      
      // Report progress for root level moves
      if (progressTracker && moveHistory.length === 0) {
        const progress = (i / limitedCandidates.length) * 80 + 10; // 10% to 90%
        progressTracker.reportProgress(Math.floor(progress));
      } else if (progressTracker && moveHistory.length === 1 && i % 3 === 0) {
        // Report less frequent progress for second level
        const rootProgress = 10 + ((i / limitedCandidates.length) * 15);
        progressTracker.reportProgress(Math.floor(rootProgress));
      }
      
      // Make the move
      const newBlackBitboard = [...blackBitboard];
      const newWhiteBitboard = [...whiteBitboard];
      const position = candidate.row * BOARD_SIZE + candidate.col;
      const slot = Math.floor(position / 32);
      const bit = position % 32;
      
      if (computerPlayer === "black") {
        newBlackBitboard[slot] |= 1 << bit;
      } else {
        newWhiteBitboard[slot] |= 1 << bit;
      }
      
      // Recursive call
      const newMoveHistory = [...moveHistory, candidate];
      
      const evaluation = minimaxAlphaBeta(
        newBlackBitboard, 
        newWhiteBitboard, 
        depth - 1, 
        alpha, 
        beta, 
        false, 
        computerPlayer, 
        humanPlayer,
        newMoveHistory,
        progressTracker
      );
      
      if (evaluation.score > maxEval) {
        maxEval = evaluation.score;
        bestMove = candidate;
      }
      
      alpha = Math.max(alpha, evaluation.score);
      if (beta <= alpha) {
        break; // Alpha-beta pruning
      }
    }
    
    return { score: maxEval, move: bestMove };
  } else {
    let minEval = Infinity;
    let bestMove = null;
    
    for (let i = 0; i < limitedCandidates.length; i++) {
      const candidate = limitedCandidates[i];
      
      // Make the move
      const newBlackBitboard = [...blackBitboard];
      const newWhiteBitboard = [...whiteBitboard];
      const position = candidate.row * BOARD_SIZE + candidate.col;
      const slot = Math.floor(position / 32);
      const bit = position % 32;
      
      if (humanPlayer === "black") {
        newBlackBitboard[slot] |= 1 << bit;
      } else {
        newWhiteBitboard[slot] |= 1 << bit;
      }
      
      // Recursive call
      const newMoveHistory = [...moveHistory, candidate];
      
      const evaluation = minimaxAlphaBeta(
        newBlackBitboard, 
        newWhiteBitboard, 
        depth - 1, 
        alpha, 
        beta, 
        true, 
        computerPlayer, 
        humanPlayer,
        newMoveHistory,
        progressTracker
      );
      
      if (evaluation.score < minEval) {
        minEval = evaluation.score;
        bestMove = candidate;
      }
      
      beta = Math.min(beta, evaluation.score);
      if (beta <= alpha) {
        break; // Alpha-beta pruning
      }
    }
    
    return { score: minEval, move: bestMove };
  }
}

// Position evaluation function for minimax
function evaluatePosition(blackBitboard, whiteBitboard, computerPlayer, humanPlayer) {
  const computerBitboard = computerPlayer === "black" ? blackBitboard : whiteBitboard;
  const opponentBitboard = computerPlayer === "black" ? whiteBitboard : blackBitboard;
  
  let score = 0;
  
  // Evaluate all positions on the board
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const position = row * BOARD_SIZE + col;
      const slot = Math.floor(position / 32);
      const bit = position % 32;
      
      const hasComputer = slot < 8 && ((computerBitboard[slot] >>> 0) & (1 << bit)) !== 0;
      const hasOpponent = slot < 8 && ((opponentBitboard[slot] >>> 0) & (1 << bit)) !== 0;
      
      if (hasComputer) {
        score += evaluateStonePosition(computerBitboard, opponentBitboard, row, col, 1);
      } else if (hasOpponent) {
        score -= evaluateStonePosition(opponentBitboard, computerBitboard, row, col, 1);
      }
    }
  }
  
  return score;
}

// Evaluate the value of a stone at a specific position
function evaluateStonePosition(playerBitboard, opponentBitboard, row, col, multiplier) {
  let totalScore = 0;
  const directions = [[0,1], [1,0], [1,1], [1,-1]];
  
  for (const [dRow, dCol] of directions) {
    const lineScore = evaluateLinePattern(playerBitboard, opponentBitboard, row, col, dRow, dCol);
    totalScore += lineScore * multiplier;
  }
  
  return totalScore;
}

// Evaluate line patterns for positional scoring
function evaluateLinePattern(playerBitboard, opponentBitboard, row, col, dRow, dCol) {
  let consecutive = 1;
  let openEnds = 0;
  let spaces = 0;
  
  // Check in positive direction
  let posConsecutive = 0;
  let posBlocked = false;
  for (let i = 1; i <= 4; i++) {
    const newRow = row + dRow * i;
    const newCol = col + dCol * i;
    
    if (newRow < 0 || newRow >= BOARD_SIZE || newCol < 0 || newCol >= BOARD_SIZE) {
      posBlocked = true;
      break;
    }
    
    const pos = newRow * BOARD_SIZE + newCol;
    const slot = Math.floor(pos / 32);
    const bit = pos % 32;
    
    if (slot < 8 && ((playerBitboard[slot] >>> 0) & (1 << bit)) !== 0) {
      posConsecutive++;
    } else if (slot < 8 && ((opponentBitboard[slot] >>> 0) & (1 << bit)) !== 0) {
      posBlocked = true;
      break;
    } else {
      break;
    }
  }
  
  // Check in negative direction
  let negConsecutive = 0;
  let negBlocked = false;
  for (let i = 1; i <= 4; i++) {
    const newRow = row - dRow * i;
    const newCol = col - dCol * i;
    
    if (newRow < 0 || newRow >= BOARD_SIZE || newCol < 0 || newCol >= BOARD_SIZE) {
      negBlocked = true;
      break;
    }
    
    const pos = newRow * BOARD_SIZE + newCol;
    const slot = Math.floor(pos / 32);
    const bit = pos % 32;
    
    if (slot < 8 && ((playerBitboard[slot] >>> 0) & (1 << bit)) !== 0) {
      negConsecutive++;
    } else if (slot < 8 && ((opponentBitboard[slot] >>> 0) & (1 << bit)) !== 0) {
      negBlocked = true;
      break;
    } else {
      break;
    }
  }
  
  consecutive += posConsecutive + negConsecutive;
  if (!posBlocked) openEnds++;
  if (!negBlocked) openEnds++;
  
  // Score based on pattern
  if (consecutive >= 5) return 100000; // Five in a row
  if (consecutive === 4) {
    if (openEnds >= 1) return 10000; // Open or semi-open four
    return 1000; // Closed four
  }
  if (consecutive === 3) {
    if (openEnds === 2) return 1000; // Open three
    if (openEnds === 1) return 100; // Semi-open three
    return 10; // Closed three
  }
  if (consecutive === 2) {
    if (openEnds === 2) return 100; // Open two
    if (openEnds === 1) return 10; // Semi-open two
    return 1; // Closed two
  }
  
  return openEnds; // Just for having open ends
}

// Deep search function specifically for hard difficulty
function findBestMoveDeepSearch(blackBitboard, whiteBitboard, computerPlayer, humanPlayer, progressCallback, searchDepth = 8) {
  const depth = searchDepth;
  
  if (progressCallback) progressCallback(5);
  
  // Create progress tracker
  const progressTracker = {
    lastReportedProgress: 0,
    reportProgress: function(progress) {
      if (progressCallback && progress >= this.lastReportedProgress + 2) { // Throttle updates
        this.lastReportedProgress = progress;
        progressCallback(Math.min(90, progress));
      }
    }
  };
  
  if (progressCallback) progressCallback(10);
  
  // Use minimax with alpha-beta pruning
  const result = minimaxAlphaBeta(
    blackBitboard, 
    whiteBitboard, 
    depth, 
    -Infinity, 
    Infinity, 
    true, 
    computerPlayer, 
    humanPlayer,
    [], // empty move history
    progressTracker
  );
  
  if (progressCallback) progressCallback(100);
  
  if (result && result.move) {
    return result.move;
  } else {
    return null;
  }
}

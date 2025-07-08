# Gomoku Game

A modern, responsive Gomoku (Five in a Row) game built with vanilla JavaScript and Vite. Play against the computer with a clean, intuitive interface. The game is deployed to [Cloudflare Pages](https://gomoku-e0c.pages.dev/).

## Features

### Game Mechanics
- **15x15 board** - Traditional Gomoku board size
- **Human vs Computer** - Play against a smart AI opponent
- **Player choice** - Choose to play as Black (first) or White (second)
- **Win detection** - Automatic detection of 5 stones in a row (horizontal, vertical, diagonal)
- **Draw detection** - Detects when the board is full with no winner

### Player Controls
- **Color selector** - Choose to play as Black or White before starting
- **AI Difficulty selector** - Choose Easy, Medium, or Hard difficulty
- **Start Game button** - Begin the game after selecting your preferences
- **New Game button** - Reset the board and start over at any time
- **Game status display** - Shows whose turn it is and game results

### Board Setup Mode
- **Setup Board button** - Enter board editing mode to create custom game positions
- **Interactive board editing** - Click cells to cycle through empty → black → white → empty
- **Computer color selection** - Choose whether the AI plays as Black or White
- **Next move selection** - Set which player moves first in the custom position
- **Clear Board button** - Quickly remove all stones from the setup board
- **Start Game from setup** - Begin playing from your custom board configuration
- **Cancel setup** - Exit setup mode and return to normal game interface

## Computer AI

The AI opponent implements a fairly sophisticated game engine with multiple algorithms and optimizations:

### Core Algorithms

#### Pattern-Based Evaluation
- **Threat Detection**: Multi-layered threat analysis system
  - Immediate win detection (5-in-a-row completion)
  - Open four patterns (unstoppable 4-stone formations)
  - Double open three threats (fork creation)
  - Four-stone patterns with gaps (X_XXX, XX_XX, XXX_X patterns)
  - **Smart blocked pattern filtering**: Avoids wasting moves on patterns that cannot extend to wins
- **Pattern Scoring**: Weighted evaluation based on:
  - Stone count in sequences (2, 3, 4, 5 stones)
  - Open ends (0, 1, or 2 open sides)
  - Extension potential (ability to create winning threats)
  - Strategic position value (center bias)

#### Alpha-Beta Pruning Search
- **Minimax Algorithm**: Classic game tree search with alpha-beta pruning
- **Iterative Deepening**: Progressively deeper searches within time constraints
- **Aspiration Windows**: Narrow search windows around expected values for faster pruning
- **Move Ordering**: Prioritizes promising moves to improve pruning efficiency

#### Advanced Optimizations

##### Bitboard Representation
- **32-bit Bitboards**: Efficient board state representation using 8 slots (256 bits total)
- **Fast Operations**: Bitwise operations for rapid position checks and updates
- **Memory Efficient**: Compact storage for game states and pattern matching

##### Search Enhancements
- **Transposition Table**: Caches evaluated positions to avoid redundant calculations
- **Killer Move Heuristic**: Prioritizes moves that caused cutoffs in similar positions
- **History Heuristic**: Statistical move ordering based on historical performance
- **Time Management**: Adaptive search depth based on remaining time and position complexity

##### Zobrist Hashing
- **Position Hashing**: 64-bit hash keys for fast position lookup and comparison
- **Incremental Updates**: Efficient hash updates during move generation
- **Collision Detection**: Handles hash collisions gracefully

### AI Difficulty Levels

#### Easy
- **Search Method**: Heuristic evaluation with pattern matching
- **Search Depth**: No deep search (immediate tactical analysis only)
- **Move Evaluation**: Basic threat detection and pattern scoring
- **Candidate Moves**: Quick evaluation of promising positions
- **Response Time**: ~1-2 seconds average
- **Behavior**: Focuses on immediate threats and basic tactical moves

#### Medium
- **Search Method**: Deep minimax search with alpha-beta pruning
- **Search Depth**: 6-ply lookahead (3 full turns ahead)
- **Move Evaluation**: Full pattern analysis with strategic positioning
- **Candidate Moves**: Evaluates top candidates with moderate planning
- **Response Time**: ~3-8 seconds average
- **Behavior**: Moderate strategic planning with threat analysis

#### Hard
- **Search Method**: Deep minimax search with alpha-beta pruning
- **Search Depth**: 8-ply lookahead (4 full turns ahead)
- **Move Evaluation**: Complete threat analysis including complex patterns
- **Candidate Moves**: Comprehensive evaluation for maximum strength
- **Advanced Features**:
  - Multi-move tactical sequences
  - Complex position evaluation
  - Advanced threat detection
  - Strategic endgame optimization
- **Response Time**: ~5-15+ seconds average (varies by position complexity)
- **Behavior**: Deep strategic planning with sophisticated threat analysis

### Move Prioritization System

The AI uses a strict priority hierarchy:

1. **AI Winning Moves** (Priority 1)
   - 5-in-a-row completion
   - Open four creation (guaranteed win next move)
   - Double open three creation (fork/multiple threats)

2. **Defensive Blocking** (Priority 2)
   - Block opponent's immediate wins
   - Block opponent's open fours
   - Block opponent's double open threes

3. **Tactical Moves** (Priority 3)
   - Create four-stone threats (only if extendable to wins)
   - Block opponent's four-stone threats (only genuine threats)
   - Strategic position improvement

4. **Positional Play** (Priority 4)
   - Alpha-beta search evaluation
   - Pattern-based scoring
   - Board control optimization

### Enhanced Threat Analysis

The AI features sophisticated pattern recognition that distinguishes between genuine threats and blocked patterns:

- **Genuine Threats**: Patterns like `XXX.` or `.XXX.` that can extend to create wins
- **Blocked Patterns**: Patterns like `|XXX.|` (blocked by opponent stones or board edges) are ignored
- **Deep Search Fallback**: When no immediate threats exist, uses deep minimax search for strategic moves
- **Context Awareness**: Considers board complexity and position type when evaluating threats

### Performance Optimizations

- **Web Worker Implementation**: Non-blocking AI computation for smooth UI
- **Progressive Search**: Incremental depth increases with time management
- **Early Termination**: Immediate response for obvious moves (wins/blocks)
- **Candidate Move Filtering**: Reduces search space by focusing on relevant positions
- **Memory Management**: Efficient cleanup of search tables and caches

The AI never gets stuck or fails to respond, with multiple fallback mechanisms ensuring reliable gameplay at all difficulty levels.

## Setup

### Prerequisites
- Node.js (version 14 or higher)
- npm

### Installation
```bash
npm install
```

### Development
```bash
npm run dev
```

### Build for Production
```bash
npm run build
```

### Preview Production Build
```bash
npm run preview
```

## License

MIT License - feel free to use this project for learning or personal use.

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

The engine checks immediate wins, mandatory blocks, open fours, and other four-stone threats before choosing a positional move. Creating a blockable four is evaluated alongside alternatives rather than selected automatically. Evaluation scores contiguous and broken formations according to their winning extensions. Winning squares and open-four moves are detected in bulk using 15-bit row, column, and diagonal masks; candidate classification reads the resulting winning-square bitboards. Search maintains 88 line masks per color, updates the four affected masks on make/undo, and reuses them for candidate and threat detection. Per-line winning squares are cached and refreshed only for those four lines; per-square reference counts preserve threats shared by crossing lines. Candidate classification and tactical horizon search read the combined cached winning-square bitboards. Incremental pattern extraction uses shifts and masks with precomputed boundary blockers. Standalone operations can construct line masks from the occupancy bitboards.

Easy uses heuristic move scoring. Medium and Hard use iterative deepening with alpha-beta search, up to 6 and 8 plies respectively. Completed iterations supply principal-variation move ordering for the next depth. Tactical candidates survive branching limits. Search resolves immediate wins directly and restricts single mandatory blocks to that blocking move, preserving terminal win-distance scores. At the search horizon, it resolves immediate wins and unavoidable losses, and follows up to four mandatory blocking moves before static evaluation. Cached winning-square counts keep quiet leaves at constant-time evaluation. Search maintains incremental per-stone line scores, recomputes only contributions affected by a move, and restores them on undo. Line patterns use nine-bit friendly and blocker masks with bitwise window checks. The full-board evaluator remains the regression reference. Search has no time deadline. The Move now button is enabled while an AI request is pending: it plays the last completed search result and terminates the worker. If depth 1 has not completed, it uses a legal candidate move. Search uses a bounded transposition table with incremental 64-bit Zobrist hashing. Cached scores match the remaining depth, evaluation perspective, and selective-search PV context and tactical extension budget; full position verification guards hash collisions. Exact scores and cutoff bounds are distinguished, and mate distances are normalized. Constant-time leaf evaluations bypass the table. Double-open-three detection is not implemented.

## Architecture

- `src/core/`: shared board constants, bitboard conversion, and array/bitboard rules.
- `src/ai/`: patterns, threats, candidate generation, evaluation, search, and engine orchestration.
- `src/ai/search-context.js`, `transposition-table.js`, and `zobrist.js`: reversible position hashing and a per-move table shared across iterative-deepening passes, capped at 32,768 entries.
- `src/ai/incremental-evaluation.js`: private search board, cached direction scores, and reversible move updates.
- `src/ai/engine.js`: `chooseMove(position, { difficulty, onProgress })`, where a position contains black and white bitboards and `toMove`. The opponent is derived from `toMove`.
- `src/ai/worker-handler.js`: injectable message handling; `src/ai-worker.js` installs it in an ES module worker.
- `src/ai/client.js`: worker lifecycle, request IDs, delayed responses, cancellation, and failure handling.
- `src/game/`: game controller with explicit idle/setup/playing/finished phases and a separate setup instance per game.
- `src/ui/view.js`: DOM rendering and input callbacks.
- `src/main.js`: browser bootstrap and worker creation.

Engine code has no browser messaging or DOM dependencies. Tests import modules directly. The baseline fixtures preserve candidate ordering, evaluation, search scores, and Easy move selection for 12 positions and both colors.

Run `npm test` for regression tests, `npm run dev` for development, and `npm run build` followed by `npm run preview` to check production assets.

## Setup

### Prerequisites
- Node.js compatible with Vite 7 (see the installed package engines requirement)
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

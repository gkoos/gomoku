# Gomoku

A 15x15 Five in a Row game against a computer opponent, built with vanilla JavaScript and Vite.

[Play online](https://gomoku-e0c.pages.dev/)

## Playing

Choose Black or White and an AI difficulty, then start a game. Five or more stones in a row wins horizontally, vertically, or diagonally.

- **Easy, Medium, Hard, and Expert:** heuristic play or progressively deeper search.
- **Move now:** while the AI is thinking, play its best completed search result.
- **New Game:** reset the board and cancel the current search.
- **Setup Board:** create a custom position, choose the computer's color and next player, then start from that position. Click cells to cycle through empty, black, and white; clear or cancel setup as needed.

## Development

Requires npm and a Node.js version compatible with Vite 7.

AI move selection runs in WebAssembly inside a worker, including Easy scoring and deeper search. Generated browser assets are checked in, so development and deployment builds need only Node/npm. See the [Rust/Wasm guide](engine-rust/README.md) to change or rebuild the engine.

```bash
npm install
npm run dev
```

| Command | Purpose |
| --- | --- |
| `npm test` | Run regression tests |
| `npm run build` | Build production assets |
| `npm run preview` | Preview the production build |

## Documentation

- [AI algorithm](docs/algorithm.md): tactical decisions, candidates, evaluation, search, and difficulty levels.
- [Implementation guide](docs/implementation.md): modules, bitboards, incremental caches, worker lifecycle, and validation.
- [Search performance](docs/performance.md): repeatable Wasm CPU profiling, measurements, and optimization priorities.
- [Self-play](docs/self-play.md): paired engine matches and configurable evaluation weights.
- [Training datasets](docs/datasets.md): reproducible position exports and training/validation splits for learned evaluation.

## License

MIT

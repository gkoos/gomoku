# Self-play and evaluation experiments

The Node runner plays complete 15×15 freestyle games using the production Rust/Wasm `MoveEngine`. Five or more stones wins. It runs one game at a time and uses fixed search depth, without thinking deadlines or randomising engine moves.

## Running matches

Build the Node bindings once after changing Rust:

```bash
npm run wasm:build
npm run selfplay -- --games=20 --depth=4 --seed=1
```

The default output is `.selfplay/matches.jsonl`, ignored by Git. Start with depth 1–4 to check the pipeline; depth 10 uses Expert's search and can be slow. `--depth` accepts 1–10. The runner retains production root shortcuts and stops iterative deepening after the requested depth or a proven result. Tactical extensions remain four plies and the transposition table holds 32,768 entries. This does not change the application's difficulty settings.

Every pair starts from the same four-ply opening, with A and B swapping colours. The seed controls reproducible adjacent opening moves, including off-centre starts. These openings provide variety, not a guarantee of balanced or representative play. Identical deterministic engines should replay the same game with engine identities swapped; repeating the empty-board game would add no information.

Re-run the same command to resume. Increase `--games` to extend the run; game counts must be even. Completed games are appended immediately. Engine module/Wasm hashes, weights, seed, depth, and runner source hashes must match the saved header. Use a different output for a different experiment:

```bash
npm run selfplay -- --games=100 --depth=4 --seed=42 --output=.selfplay/experiment.jsonl
```

Run only one writer per output file. If a process or machine crash leaves a partial last line, remove that incomplete line before resuming. Interrupted games are replayed from their opening; completed games are preserved. A move search is synchronous, so interruption responsiveness depends on the current Wasm iteration.

## Comparing builds and weights

By default A and B use `engine-rust/pkg/nodejs/gomoku_engine.js`. To retain a baseline, copy the entire Node bindings directory, including `package.json` and the `.wasm` file, before rebuilding. Then pass `--a=path/to/baseline/gomoku_engine.js` and `--b=path/to/candidate/gomoku_engine.js`. Older `MoveEngine` builds can compete with their default weights; custom weights require the new factory API.

Weight files are JSON objects. Omitted entries retain the defaults; unknown names, non-integers, and values outside 0–100,000 are rejected. For example:

```json
{
  "openThree": 1200,
  "closedThree": 120,
  "openTwo": 90
}
```

```bash
npm run selfplay -- --games=100 --depth=4 --seed=42 --weights-b=weights.json --output=.selfplay/weights-test.jsonl
```

| Name | Default |
| --- | ---: |
| `five` | 100000 |
| `openFour` | 20000 |
| `closedFour` | 10000 |
| `openThree` | 1000 |
| `closedThree` | 100 |
| `openTwo` | 100 |
| `closedTwo` | 10 |
| `singleWindow` | 1 |

These names refer to the evaluator's existing pattern classifications. The single-stone score multiplies the window weight by at most two. Custom values enter incremental evaluation before search begins and remain fixed throughout that search. Scores retain the existing static clamp. Exact wins, win-distance scoring, mandatory replies, candidate priorities, root shortcuts, and Easy's separate move-scoring heuristic are unchanged. There is no ordering constraint on weights: determining useful relative values is the purpose of an experiment.

The Wasm API is `MoveEngine.with_weights(black, white, computerBlack, difficulty, extension, tableCapacity, Int32Array)`, with the eight values in the table's order. The existing constructor and browser defaults remain compatible. JavaScript fallback evaluation still uses its original defaults; configurable evaluation currently applies to the Rust/Wasm engine.

## Records and interpretation

The first JSONL record describes the run. Each subsequent record is one finished game, containing engine colour assignments, opening, full move sequence, winner, and per-move player, position, elapsed milliseconds, completed depth, score, node count, cache hits, and principal variation. Positions are zero-based `row * 15 + column`; Black moves first. Search statistics sum all completed iterations for that move. Root shortcuts have depth zero, no search score, and zero search nodes.

The runner validates move legality and independently checks the result. It also replays saved games when resuming. The printed summary reports wins/draws/losses and move counts, nodes, and elapsed time by engine. Timing is informational and varies between runs.

Games are training material, not an automatic learning process. Weight tuning still needs an optimizer and independent validation openings. Use different seeds for tuning and validation, preserve tactical regression tests, and test across multiple opponents before accepting a strength claim. Paired results are correlated; a handful of wins does not establish an improvement.

For future NNUE work, the move sequence reconstructs every board, while results and search scores provide possible labels. Root shortcuts have no score label, and search scores are relative to the player moving. Choosing training targets, sampling positions, and avoiding training/validation leakage are later steps.

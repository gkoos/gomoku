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

## Batch weight experiments

Compare several weight files against default evaluation with one command:

```bash
npm run selfplay:batch -- --games=100 --depth=4 --seeds=1,2,3
```

The default plan is `experiments/weights.json`. It includes stronger threes, a lower closed-four score, and stronger twos. These are deliberately different experimental settings, not recommended improvements. A default-versus-default control is included automatically. Each seed supplies the same opening pairs to every candidate, with colours swapped. This command plays 100 games per seed per entry: 1,200 games including the control and three candidates. Matches run sequentially.

In Windows PowerShell, use `npm.cmd` instead of `npm` when passing options after `--`; the PowerShell npm wrapper can consume those arguments. Alternatively call `node scripts/selfplay/batch.js --games=100 --depth=4 --seeds=1,2,3` directly.

Create your own plan with unique names and paths relative to the plan file:

```json
{
  "candidates": [
    { "name": "my-variant", "file": "weights/my-variant.json" }
  ]
}
```

```bash
npm run selfplay:batch -- --config=my-experiment.json --games=100 --depth=4 --seeds=11,12,13 --output=.selfplay/my-experiment
```

The output directory holds a batch manifest, individual resumable JSONL matches, and `results.md`/`results.json`. Reports update after each completed match file. Re-running resumes the games; increasing `--games` extends them. Depth, seeds, candidate names/values, and engine hashes must match the manifest. Do not run simultaneous writers in the same directory. As with single matches, a partial final JSONL record needs repair after a crash.

The table reports candidate wins/draws/losses, score percentage (wins plus half of draws), candidate nodes per move, and mean thinking time per move for both engines. A score above 50% is an observed advantage over the baseline, not a statistical strength claim. Paired games are correlated, and selecting the best of multiple experiments introduces selection bias. Validate promising settings with a separate seed set and a greater depth in a new output directory.

Optional `--a`/`--b` choose baseline/candidate Node engine builds. The control uses build A for both sides; experimental entries compare build B with the configured weights against default-weight build A. To isolate weight effects, use the same build for both.

See [stronger-twos validation](weight-validation.md) for a recorded follow-up experiment and reproduction commands.

## Records and interpretation

The first JSONL record describes the run. Each subsequent record is one finished game, containing engine colour assignments, opening, full move sequence, winner, and per-move player, position, elapsed milliseconds, completed depth, score, node count, cache hits, and principal variation. Positions are zero-based `row * 15 + column`; Black moves first. Search statistics sum all completed iterations for that move. Root shortcuts have depth zero, no search score, and zero search nodes.

The runner validates move legality and independently checks the result. It also replays saved games when resuming. The printed summary reports wins/draws/losses and move counts, nodes, and elapsed time by engine. Timing is informational and varies between runs.

Games are training material, not an automatic learning process. Weight tuning still needs an optimizer and independent validation openings. Use different seeds for tuning and validation, preserve tactical regression tests, and test across multiple opponents before accepting a strength claim. Paired results are correlated; a handful of wins does not establish an improvement.

The [dataset exporter](datasets.md) reconstructs sampled positions with outcome and search labels, merges symmetric duplicates, and splits related games together for future NNUE work.

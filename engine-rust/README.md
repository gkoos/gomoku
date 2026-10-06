# Rust/Wasm engine

This crate provides the computational engine for the browser worker. It implements occupancy utilities, nine-cell directional pattern classification, full-board static evaluation, maintained line masks, winning-square caches, incremental make/undo evaluation, candidate generation, Zobrist hashing, transposition caching, and iterative alpha-beta search. The production worker uses Wasm for root tactical orchestration, Easy scoring, and Medium/Hard/Expert deep search. JavaScript retains a reference implementation and initialization fallback.

## Layout

- `src/bitboards.rs`: eight-word occupancy boards, row-major set-bit iteration, overlap and fullness checks.
- `src/patterns.rs`: directional extraction and mask-indexed pattern lookup.
- `src/pattern_reference.rs`: reference bitmask classifier, pattern representation and scores.
- `build.rs`: generates the compact lookup table at compile time.
- `src/evaluation.rs`: full-board evaluation with JavaScript-compatible perspective and score clamping.
- `src/lines.rs`: shared geometry, 88 line masks per color, packed extraction, and reference-counted winning squares.
- `src/incremental.rs`: reversible score updates with fixed-size undo buffers and preallocated move history.
- `src/neighborhood.rs`: maintained radius-two occupancy density and reversible neighborhood updates.
- `src/moves.rs`: shift-generated candidate neighborhoods, density priorities, tactical classification, stable tie ordering, and fixed-size output buffers.
- `src/root.rs`: root priorities, open-four defense, and Easy move scoring.
- `src/rules.rs`: anchored wins and root terminal validation.
- `src/zobrist.rs`: reversible two-word position hashes matching JavaScript.
- `src/transposition.rs`: bounded FIFO search cache with position verification and mate normalization.
- `src/search.rs`: iterative alpha-beta, PV ordering, forced branches, and bounded tactical horizon.
- `src/lib.rs`: native module exports and validated WebAssembly bindings.

Occupancy stays in `[u32; 8]` for direct parity with JavaScript. Bit 31 is ordinary unsigned occupancy; only bit zero of the final word represents a valid square. Standalone pattern extraction reads nine squares for reference evaluation. Maintained extraction uses precomputed shifts and boundary masks on the four directional lines. Geometry and affected-score mappings are initialized once and shared across evaluator instances.

## Toolchain

Install stable Rust with the Windows MSVC prerequisites when using Windows, then:

```powershell
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked
```

The CLI version must match the pinned wasm-bindgen dependency. Cargo.lock is committed for reproducible dependency resolution.

## Build and validation

From the repository root:

```powershell
npm run rust:test
npm run wasm:check
npm run wasm:benchmark
npm run wasm:profile
```

`wasm:check` builds the release module and generates bindings under `engine-rust/pkg/web` and `engine-rust/pkg/nodejs`, then compares the actual Wasm module with the JavaScript reference. It checks every ternary nine-cell configuration in four directions, random boards at several densities, every board anchor, both evaluation perspectives, signed-word boundaries, padding, overlaps, and invalid binding inputs. The state parity script additionally checks line masks and winning boards against full reconstruction through 1,396 make/undo snapshots, packed windows, all-square updates, crossing reference counts, failed moves, stale undo tokens, and detached output arrays. Search parity checks compare 204 completed iterations and 400 fixed searches, including scores, principal variations, nodes, cache hits/cutoffs/size, zero/nonzero extension budgets, tiny-table eviction, narrowing/widening alpha-beta windows, terminal roots, ten-ply caps, and root hash/occupancy restoration. Candidate parity checks compare complete move lists across 4,628 board/color cases, including density thresholds, both colors, cached and standalone paths, signed words, padding, and make/undo sequences. Bindings under engine-rust/pkg and Cargo build output are ignored by Git. `npm run wasm:build` builds without running the parity script.

`npm run wasm:build` also copies browser bindings and the binary to `src/ai/wasm/`, recording source and artifact hashes in `build.json`. Commit these assets with Rust changes. Development and production builds reject missing or stale assets, but require no Rust installation when assets are current. `npm test` exercises the committed browser module.

Vite bundles the web binding module into the worker and emits Wasm as a separate asset. `wasm-runtime.js` initializes it lazily for all difficulties; `wasm-search.js` forwards completed iterations and frees search state afterward. Initialization failure is reported once and uses JavaScript search for that worker. Cloudflare builds continue to need only Node/npm.

Classification looks up one of 19,683 nine-cell ternary patterns. A precomputed 512-entry mask-to-ternary map converts friendly/blocker bitmasks into a table index without reading individual squares. Each table entry is a u16: stones in bits 0?2, windows 3?5, winning count 6?9 and open-three/open-two flags 10/11. The internal table uses 39,366 bytes plus the index map; public pattern packing is unchanged. Cargo generates the table from the reference classifier at build time, so browser initialization does not construct it. Build/source freshness includes build.rs.

Bindings accept eight-word unsigned arrays. Analyze accepts a square index (0–224) and direction index: horizontal, vertical, descending diagonal, ascending diagonal. Evaluation accepts black occupancy, white occupancy, and a boolean black perspective. Pattern results pack stones, windows, and winning-move counts into the low three bytes, with open-three/open-two flags in bits 24/25. This compact representation avoids allocating result objects for each analysis.

## Maintained state API

The Wasm `SearchState` class owns private occupancy, directional masks, winning-square reference counts, cached scores, and undo history. Its constructor accepts black and white eight-word arrays and a boolean black perspective.

- `make_move(position, black)` returns a numeric undo token.
- `undo_move(token)` accepts only the latest outstanding token. Tokens are not reused after undo, so stale branch tokens cannot undo a later move.
- `score()` returns the clamped perspective score; the internal total remains unclamped for exact restoration.
- `line_masks(black)`, `winning_squares(black)`, `winning_references(black)`, and `occupancy(black)` return detached copies.
- `analyze_pattern(position, direction, black)` classifies a packed directional window.
- `has_immediate_threat(black)` reads the cached winning-square count.
- `candidates(player_black)` returns ranked moves using maintained winning-square caches.
- `history_length()` reports outstanding moves.
- Call `free()` when a Wasm state is no longer needed.

Each move updates exactly four directional masks, recomputes only their winning-square entries for both colors, and refreshes affected anchor scores. Undo restores saved deltas without rebuilding the caches. Frames contain fixed buffers for up to 36 score contributions and eight winning-line changes; the history stack is preallocated for 225 moves. Caller arrays are never mutated.

## Candidate generation API

The standalone `generate_candidates(black, white, player_black)` binding reconstructs line and winning-square state. `SearchState.candidates(player_black)` reuses the maintained cache. Both return an Int32Array of triples: square position, priority, tactical classification. Classification is 2 for an immediate win, 1 for a block, and 0 for a quiet move; -1 denotes opening candidates, where JavaScript omits the tactical property. Row and column are derived from position.

The native `generate_into` function accepts a caller-owned `Candidates` buffer containing up to 225 fixed-size records. It generates radius-one and density-qualified radius-two frontiers with row-mask shifts, computes original priorities, ranks by tactics/priority/source rank, and preserves all tactical moves beyond the normal cap. When the frontier exceeds twice the retained count, it partitions out the best 30/50 (or tactical count) before sorting that subset; smaller frontiers use a full sort. Both paths preserve the exact original ordered prefix. The total ordering permits allocation-free unstable sorting while preserving JavaScript tie order. Search and maintained-state candidate generation reuse 225 radius-two density counts. Standard make/undo updates at most 25 counts; standalone generation reconstructs them once. Search skips these updates for leaf and tactical-horizon placements, which never generate candidates, then restores the parent before generation resumes. Only Wasm output conversion allocates a returned vector. Candidate membership, widths, and scoring are unchanged from the JavaScript algorithm.

## Root move-selection API

`MoveEngine(black, white, computer_black, difficulty, extension, table_capacity)` is the production entry point. Difficulty values 0/1/2/3 select Easy/Medium/Hard/Expert. `root_move()` returns a chosen square, -1 for terminal positions, or -2 when iterative search is required. `next_depth()` then uses the same packed iteration format as `SearchEngine`; free the instance afterward. Root tactics preserve JavaScript priorities and row-major ties, including winning counterattacks ahead of open-four defense. Easy uses its original enhanced pattern weights, blocking bonuses, candidate priority and local-density/center scoring.

Root preparation constructs line masks and winning caches once. Defense temporarily updates four line masks and refreshes winning entries only when testing a forcing counterattack. Remaining opponent open-four threats are checked against updated masks rather than reconstructed boards. Search takes ownership of prepared masks/caches and initializes contributions once.

`select_root` and `score_root_move` are diagnostic bindings used to verify root choices and exact heuristic scores. `wasm:check` includes 9,280 root selections and 20,030 move scores across fixtures, random densities, both colors, all open-four orientations and board edges. `wasm:benchmark` also measures root defense, counterattack and Easy scoring separately from deep search.

## Search API and caching

The Wasm `SearchEngine` constructor accepts black/white arrays, black perspective, maximum depth, tactical-extension budget, and table capacity. Capacity zero disables caching. Defaults are supplied by callers; the current engine policy uses caps 6/8/10, extension 4, and capacity 32,768. Depth and extension are restricted to 0?225, and table capacity to at most 1,000,000.

`next_depth()` completes one synchronous iterative-deepening pass. Its Float64Array contains depth, score, nodes, cache hits, cache cutoffs, table size, PV length, and PV square positions. The first PV position is the chosen move. An empty array indicates completion or a terminal root. Terminal wins/losses stop iteration early. Call `free()` when finished.

`fixed_depth(depth, maximizing, alpha, beta)` supports diagnostic searches and bound tests. The allocated maximum must cover depth, and alpha must be below beta. These diagnostics can retain cache entries across calls; iterative search uses a full window internally. Getters expose copied occupancy and hash words for state-restoration checks. Search always tracks PVs, so there is no untracked-PV cache mode.

Each search owns one incremental evaluator, hasher, bounded table, and preallocated candidate buffer per ply. The hash uses the same deterministic stone/side keys as JavaScript. Table keys contain exact depth, extension budget, perspective, and applicable prior-PV suffix; hits also verify both complete boards and side to move. Entries distinguish exact/lower/upper bounds and normalize mate distance. Fixed-size PV arrays and reversible state avoid creating child boards at each node. The table uses a HashMap plus a FIFO queue, with JavaScript-compatible bound replacement rules.

Search takes immediate wins directly and preserves tactical candidates and matching PV moves through width limits. When the current player has no immediate win and the opponent has exactly one winning square, search reads that square from the winning cache and bypasses candidate generation/ranking. It searches the same single reply through ordinary recursion, with unchanged node counting, cache bounds, mate distance and state restoration. Multiple winning moves retain the existing candidate ordering. At depth zero it follows forced blocking sequences within the supplied extension budget. Quiet leaves use cached evaluation and bypass the table. Search restores occupancy, scores, winning caches, and hashes before returning each iteration, including ordinary propagated errors.

This is synchronous recursive search. The adapter publishes results between completed depths. Move now plays the latest completed result (or the legal fallback) and terminates the worker. Reset also terminates it and rejects stale replies. Cancellation cannot be processed as a message during an iteration. Pondering and resumable searches remain future work.

## Performance measurements

`wasm:benchmark` uses two fixed baseline positions, two warmup runs, seven timed runs per implementation, alternating execution order, and median times. It includes search construction and iteration calls and verifies identical scores, node counts, and PVs. It measures Node-hosted Wasm rather than browser runtime.

On this Windows machine, Node 24.2.0 with release-built Rust 1.99.0 measured:

| Position | Cap | JavaScript | Wasm | Speedup |
| --- | --- | --- | --- | --- |
| seeded-1 | 6 | 160.6 ms | 41.8 ms | 3.85? |
| seeded-4 | 5 | 54.0 ms | 15.3 ms | 3.52? |

These sampled timings are not a guarantee across positions or browsers. Re-run locally; browser performance should be measured separately.

For repeatable CPU profiles and current optimization priorities, see [search performance](../docs/performance.md). `wasm:profile` writes ignored summary/profile artifacts under `.profiles/wasm-search/` without instrumenting the engine.

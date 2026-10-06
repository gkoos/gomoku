# Implementation guide

## Module map

| Modules | Responsibility |
| --- | --- |
| core/constants.js, core/bitboards.js, core/rules.js | Dimensions, occupancy utilities, rules, fallback |
| ai/engine.js | Public move selection and tactical orchestration |
| ai/moves.js | Candidate neighborhoods, ranking, classification |
| ai/patterns.js, ai/threats.js | Directional patterns and tactical selection |
| ai/line-bitboards.js | Directional masks and winning-square caches |
| ai/evaluation.js, ai/incremental-evaluation.js | Reference evaluation and reversible cached scores |
| ai/search.js, ai/tactical-search.js | Iterative alpha-beta and horizon replies |
| ai/zobrist.js, ai/search-context.js, ai/transposition-table.js | Hashing and search cache |
| ai/worker-handler.js, ai-worker.js | Message handling and worker installation |
| ai/wasm-search.js, ai/wasm-runtime.js, ai/wasm/ | Wasm adapter, initialization, generated browser assets |
| engine-rust/src/ | Native search, patterns, candidates, incremental state and caching |
| ai/client.js | Worker lifecycle and completed-search tracking |
| game/controller.js, game/setup.js | Game phases and setup state |
| ui/view.js, main.js | DOM rendering and browser bootstrap |

Engine modules do not require a DOM or browser worker. Worker handling accepts injected functions for testing. Root bitboards.js and rules.js provide compatibility re-exports of core modules.

## Engine API

[engine.js](../src/ai/engine.js) exports chooseMove:

```js
const move = await chooseMove(
  { blackBitboard, whiteBitboard, toMove: 'black' },
  {
    difficulty: 'expert',
    onProgress: percent => {},
    onIteration: result => {},
  },
);
```

The opponent is derived from toMove. The result contains row and col, with possible candidate metadata, or is null on a terminal position. Direct iteration callbacks include depth, move, score, nodes, principal variation, and cache statistics. Root tactical shortcuts can return without an iteration callback.

## Occupancy bitboards

Each color has eight numeric 32-bit words. Position is row × 15 + col; word is position >>> 5, bit is position & 31. Seven words cover positions 0–223. Only bit zero of the eighth word represents a square: position 224.

JavaScript bitwise operations use signed 32-bit integers. Negative words can contain valid stones. Unsigned conversions are used where needed for hashing and comparisons. Enumeration and word-level rules mask padding bits in the final word.

Set-bit iteration isolates the lowest bit, finds its index with Math.clz32, and clears it with mask &= mask - 1. Ascending words and bits preserve row-major order. OR combines occupancy, AND detects overlap, and masked complements identify empty squares. Full-board checks compare combined words with valid-square masks.

The UI also holds a two-dimensional board for rendering and setup. Converting that representation necessarily reads its cells. Directional masks supplement rather than replace occupancy boards.

## Directional masks and pattern extraction

[line-bitboards.js](../src/ai/line-bitboards.js) defines 88 lines per color: 15 rows, 15 columns, and 29 diagonals in each direction, including short diagonals. Masks are stored in Uint16Array instances. Every square belongs to exactly four lines.

Precomputed memberships map squares to line IDs and bit positions. Make/undo changes four masks. Precomputed nine-square window metadata allows anchored extraction with shifts, masks, and boundary blockers. The JavaScript reference classifies bitwise windows directly. Rust converts extracted friendly/blocker masks into a ternary index using a precomputed mask map, then reads a build-generated lookup table. All 19,683 nine-cell configurations have compact two-byte entries; public pattern fields and packing remain unchanged. Directional extraction still uses maintained line bitboards.

Rust search and maintained-state candidate generation also reuse the first 15 line masks (the horizontal rows). OR combines both colors into row occupancy; popcount supplies the stone count. Standard make/undo already updates these masks, so this adds no state or update work. Standalone candidate generation retains its board-to-row reconstruction path.

Bulk threat detection finds consecutive and broken four completions in line masks. Their squares combine into global eight-word winning boards, deduplicating crossings.

## Incremental state and make/undo

[incremental-evaluation.js](../src/ai/incremental-evaluation.js) owns private occupancy copies, four signed contributions per square in an Int32Array, and a running score. Initialization visits occupied squares only.

A placement affects anchored windows up to four squares away in each direction. Affected contribution indices are precomputed. Making a move:

1. Saves affected score entries.
2. Updates occupancy and four directional masks.
3. Refreshes winning-square cache entries for those four lines, for both colors.
4. Recomputes affected contributions and adjusts the running score.

Each color's winning cache holds per-line masks, a combined winning board, a winning-square count, and Uint8Array reference counts. A square can be threatened along multiple lines. Removing one threat clears its global bit only when the reference count reaches zero.

Undo restores saved score/cache entries and reverses occupancy and directional changes. Search also reverses the Zobrist hash. Recursive branches use try/finally to restore state after errors, including thrown callbacks. Undo must follow reverse move order.

Rust search bypasses candidate generation when those caches show no own immediate win and exactly one opponent winning square. It searches that mandatory block directly through the ordinary recursive path; multiple wins/blocks retain candidate ordering.

Candidate classification reads cached winning boards. Horizon search retrieves their set bits directly. Quiet leaves return cached scores without rescanning stones or lines.

Rust search also maintains 225 neighborhood density counts, including each square's radius-two center. Standard make/undo changes at most 25 counts and candidate generation reuses them. Leaf and tactical-horizon branches skip density updates because they read only evaluation/winning caches; their undo frames record this choice, and search restores the parent before generating candidates again. The JavaScript reference continues to reconstruct counts.

Rust's search-specific candidate generator partitions directly to the selective search width and sorts that prefix. It computes PV eligibility against the original 30/50 generation cap before promotion, preserving the same quiet-move replacement and tactical retention. The general candidate generator still returns the complete original capped list. The old two-stage selector remains only in native tests for exact comparisons across every possible PV square.

## Hashing and transposition table

[zobrist.js](../src/ai/zobrist.js) uses a deterministic key containing two 32-bit words. Each color/square pair has a random key; side to move has another. Initialization XORs occupied-square keys. Make and undo XOR the same stone and side keys, making updates reversible.

The table is a Map capped at 32,768 entries by default. New entries evict the oldest at capacity. A search context is shared across iterative depths for one move, rather than persisting across games.

Keys include the position hash, exact remaining depth, perspective, tactical-extension budget, PV-tracking mode, and applicable remaining principal-variation suffix. Selective ordering can alter the searched move set, so these fields prevent incompatible reuse. Deeper entries are not automatically substituted for shallower horizons.

Quiet tactical leaves use a separate VCF cache containing relative winning continuations or unknown results. Full black/white occupancy and the attacker identify a position, so this cache does not depend on Zobrist collision assumptions, evaluation weights, or the root perspective. Scores are constructed at the call site using the current root distance. Each search retains at most 2,048 entries and clears the cache when inserting beyond that bound. Unknown results are reusable only under the fixed seven-ply/32-node horizon limits. A line-mask eligibility check skips probes when no unblocked five-cell window contains three friendly stones. VCF operates on maintained line boards and winning caches in Rust and restores them before returning. Its internal nodes are bounded separately and are not included in the existing alpha-beta node counter.

The rerunnable timing check is `node scripts/benchmark-vcf-horizon.js`. It accepts `--wasm=PATH` to benchmark a saved older Wasm artifact and `--output=PATH` to preserve results with the artifact SHA-256. It warms each fixture twice, then reports the median of seven runs along with completed depth, score, alpha-beta nodes and PV. Winning fixtures may finish at a shallower iteration, so these timings compare complete move calculations rather than identical searched trees. Run comparisons without concurrent CPU-heavy work.

Entries contain exact scores, lower bounds, or upper bounds. Bounds are reused only when they justify a cutoff. Full unsigned occupancy snapshots and side to move are checked on hits to guard against hash collisions. Mate scores are normalized on storage and adjusted for current root distance on retrieval. Horizon evaluation bypasses the table.

## Worker lifecycle and Move now

The production worker initializes Wasm once and uses Rust for all difficulties. `MoveEngine` validates the root, selects immediate wins/blocks, creates open fours, and scores Easy candidates. Easy returns its heuristic open-four defense. Searched difficulties pass that defense as a first-iteration ordering preference, allowing forcing counterattacks to compete. Defense updates only the four affected line masks and winning-cache entries. The prepared line masks and winning cache transfer into the incremental evaluator without rebuilding them. While comparing root moves, search checks the opponent's immediate open-four creation when neither side has an immediate win, preventing candidate pruning from hiding a guaranteed three-ply reply. The adapter calls `MoveEngine.next_depth()` and forwards completed iterations through the existing protocol. It frees search state when finished or a callback throws. Initialization failures are reported once and retain JavaScript search for that worker.

The client sends FIND_BEST_MOVE with requestId and data containing position and difficulty. The worker echoes the ID in PROGRESS_UPDATE, SEARCH_ITERATION, and BEST_MOVE_FOUND replies. SEARCH_ITERATION forwards completed depth and move; richer statistics remain available through the direct engine callback.

The client starts with a legal fallback and retains each completed search result. Move now plays the latest completed move, or the fallback before depth one finishes, then terminates the worker. Reset also cancels pending work. Worker identity and request-ID checks reject obsolete replies. Later searches can create replacement workers.

Search runs synchronously inside the worker. Cancellation terminates it rather than depending on a message being processed during recursion. There is no deadline. Wasm progress reports completed depths, not remaining wall-clock time.

The controller has idle, setup, playing, and finished phases. Guards prevent stale replies from placing stones after resets, during setup, or after game end. Errors trigger legal fallback behavior.

## Validation and development

Run npm test for regression tests and npm run build for production bundling.

Browser bindings and the Wasm binary in `src/ai/wasm/` are committed. Development and production builds check their hashes against Rust sources; stale or missing assets require `npm run wasm:build`. This keeps Cloudflare builds Node-only. Rebuilding requires Rust and the pinned wasm-bindgen CLI; commit regenerated assets with Rust changes. Text hashes normalize line endings across Windows/Linux checkouts. See the [Rust/Wasm guide](../engine-rust/README.md) for native tests, parity checks and repeatable benchmarks.

Coverage includes reference candidate ordering, exhaustive line patterns, signed words and edges, tactical counterattacks, forced branches, horizon budgets, difficulty depth caps, cache parity/collisions, make/undo restoration, worker messages, and controller cancellation. Baseline fixtures preserve representative expected results.

For incremental changes, compare maintained state with full reconstruction throughout make/undo. For candidate changes, compare complete move objects and ordering, not just membership. For caching changes, compare completed scores and principal variations against uncached search. Benchmark identical positions with warmups and repeated runs; selective-search changes can alter node counts as well as runtime.


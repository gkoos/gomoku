# Rust/Wasm engine prototype

This crate is the first stage of the engine port on `feat/rust-wasm-engine`. It implements occupancy utilities, nine-cell directional pattern classification, full-board static evaluation, maintained line masks, winning-square caches, incremental make/undo evaluation, and candidate generation. The browser still uses the JavaScript engine. Tactical orchestration, search, hashing, and worker integration have not been ported yet.

## Layout

- `src/bitboards.rs`: eight-word occupancy boards, row-major set-bit iteration, overlap and fullness checks.
- `src/patterns.rs`: directional extraction, mask classification, and search pattern scores.
- `src/evaluation.rs`: full-board evaluation with JavaScript-compatible perspective and score clamping.
- `src/lines.rs`: shared geometry, 88 line masks per color, packed extraction, and reference-counted winning squares.
- `src/incremental.rs`: reversible score updates with fixed-size undo buffers and preallocated move history.
- `src/moves.rs`: shift-generated candidate neighborhoods, density priorities, tactical classification, stable tie ordering, and fixed-size output buffers.
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
```

`wasm:check` builds the release module and generates bindings under `engine-rust/pkg/web` and `engine-rust/pkg/nodejs`, then compares the actual Wasm module with the JavaScript reference. It checks every ternary nine-cell configuration in four directions, random boards at several densities, every board anchor, both evaluation perspectives, signed-word boundaries, padding, overlaps, and invalid binding inputs. The state parity script additionally checks line masks and winning boards against full reconstruction through 1,396 make/undo snapshots, packed windows, all-square updates, crossing reference counts, failed moves, stale undo tokens, and detached output arrays. Candidate parity checks compare complete move lists across 4,628 board/color cases, including density thresholds, both colors, cached and standalone paths, signed words, padding, and make/undo sequences. Generated bindings and Cargo build output are ignored by Git. `npm run wasm:build` builds without running the parity script.

For browser use, the web binding module exports an asynchronous default initializer. Initialize it with the emitted Wasm asset, then call named exports. This prototype is not yet connected to Vite or the production worker. No Rust build is required for existing `npm test`, `npm run dev`, or `npm run build` commands.

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

The native `generate_into` function accepts a caller-owned `Candidates` buffer containing up to 225 fixed-size records. It generates radius-one and density-qualified radius-two frontiers with row-mask shifts, computes original priorities, sorts by tactics/priority/source rank, and preserves all tactical moves beyond the normal cap. The total ordering permits allocation-free unstable sorting while preserving JavaScript tie order. Only Wasm output conversion allocates a returned vector. Candidate membership, widths, and scoring are unchanged from the JavaScript algorithm.

This is a correctness baseline, not yet a replacement for the JavaScript search. Measure complete search after the remaining port before drawing performance conclusions.

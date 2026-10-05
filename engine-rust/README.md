# Rust/Wasm engine prototype

This crate is the first stage of the engine port on `feat/rust-wasm-engine`. It implements occupancy utilities, nine-cell directional pattern classification, and full-board static evaluation. The browser still uses the JavaScript engine. Candidate generation, tactical orchestration, maintained line boards, incremental evaluation, search, hashing, and worker integration have not been ported yet.

## Layout

- `src/bitboards.rs`: eight-word occupancy boards, row-major set-bit iteration, overlap and fullness checks.
- `src/patterns.rs`: directional extraction, mask classification, and search pattern scores.
- `src/evaluation.rs`: full-board evaluation with JavaScript-compatible perspective and score clamping.
- `src/lib.rs`: native module exports and validated WebAssembly bindings.

Occupancy stays in `[u32; 8]` for direct parity with JavaScript. Bit 31 is ordinary unsigned occupancy; only bit zero of the final word represents a valid square. Pattern extraction currently reads nine squares, matching the standalone reference evaluator. Maintained directional extraction will follow in a later stage.

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

`wasm:check` builds the release module and generates bindings under `engine-rust/pkg/web` and `engine-rust/pkg/nodejs`, then compares the actual Wasm module with the JavaScript reference. It checks every ternary nine-cell configuration in four directions, random boards at several densities, every board anchor, both evaluation perspectives, signed-word boundaries, padding, overlaps, and invalid binding inputs. Generated bindings and Cargo build output are ignored by Git. `npm run wasm:build` builds without running the parity script.

For browser use, the web binding module exports an asynchronous default initializer. Initialize it with the emitted Wasm asset, then call named exports. This prototype is not yet connected to Vite or the production worker. No Rust build is required for existing `npm test`, `npm run dev`, or `npm run build` commands.

Bindings accept eight-word unsigned arrays. Analyze accepts a square index (0–224) and direction index: horizontal, vertical, descending diagonal, ascending diagonal. Evaluation accepts black occupancy, white occupancy, and a boolean black perspective. Pattern results pack stones, windows, and winning-move counts into the low three bytes, with open-three/open-two flags in bits 24/25. This compact representation avoids allocating result objects for each analysis.

This is a correctness baseline, not an optimized replacement for the incremental JavaScript search. Measure complete search after the remaining port before drawing performance conclusions.

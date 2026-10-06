# Engine documentation

- [AI algorithm](algorithm.md): move selection, candidates, evaluation, search, and difficulty levels.
- [Implementation guide](implementation.md): modules, bitboards, incremental state, caching, workers, and validation.
- [Rust/Wasm engine](../engine-rust/README.md): toolchain, browser integration, parity validation, and benchmarks.
- [Search performance](performance.md): repeatable Wasm CPU profiling, measurements, and optimization priorities.
- [Self-play](self-play.md): reproducible paired matches, configurable evaluation weights, and saved training records.
- [Training datasets](datasets.md): position reconstruction, labels, deduplication, and leakage-safe splits for learned evaluation.
- [NNUE experiment](nnue.md): offline CPU training, portable weights, incremental inference, and recorded validation results.

These pages describe the current implementation. See the [project README](../README.md) for installation and development commands.

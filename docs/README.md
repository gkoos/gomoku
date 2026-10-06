# Engine documentation

- [AI algorithm](algorithm.md): move selection, candidates, evaluation, search, and difficulty levels.
- [Implementation guide](implementation.md): modules, bitboards, incremental state, caching, workers, and validation.
- [Rust/Wasm engine](../engine-rust/README.md): toolchain, browser integration, parity validation, and benchmarks.
- [Native engine](native-engine.md): Gomocup/Piskvork executable, match-manager setup, and protocol validation.
- [External matches](external-matches.md): rerunnable Rapfi baselines, paired openings, validated results, and move timings.
- [External loss analysis](external-loss-analysis.md): defensive-shortcut reproductions, selective mate limitations, and tactical priorities.
- [Search performance](performance.md): repeatable Wasm CPU profiling, measurements, and optimization priorities.
- [Self-play](self-play.md): reproducible paired matches, configurable evaluation weights, and saved training records.
- [Training datasets](datasets.md): position reconstruction, labels, deduplication, and leakage-safe splits for learned evaluation.
- [NNUE experiment](nnue.md): offline CPU training, portable weights, incremental inference, and recorded validation results.
- [Stronger-search NNUE targets](nnue-search-targets.md): resumable teacher searches, score distillation, and paired-match comparisons.

These pages describe the current implementation. See the [project README](../README.md) for installation and development commands.

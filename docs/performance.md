# Search performance profiling

## Reproduce

Run from the repository root with the Rust/Wasm toolchain installed:

```sh
npm run wasm:profile
# Longer sampling windows:
npm run wasm:profile -- --duration-ms=5000
```

This builds the release Wasm module and samples it with Node's built-in V8 CPU profiler. It saves `.profiles/wasm-search/summary.json` and one `.cpuprofile` per position. Load CPU profiles in Chrome DevTools' JavaScript profiler to inspect call stacks. Output is ignored by Git. The JSON includes input boards, configured/completed depths, scores, PVs, nodes, hits/cutoffs, timing medians, sample counts, function shares, runtime details and a Wasm SHA-256 fingerprint.

The script uses fixed baseline positions and a fixed forcing-chain fixture, two warmups and seven alternating cache-on/off timing runs. Every timing run must match its reference search statistics; cached and uncached runs must agree on final depth, score and PV. Sampling is separate from timing measurements. Each sampling window repeatedly runs complete searches including construction, all completed iterations and freeing state. A window finishes after its current search, so its duration can exceed the requested target.

Root shortcuts are deliberately bypassed to profile recursive search. Some tactical fixtures would normally return before search in the production worker. This measures Node-hosted Wasm, rather than browser performance or total UI latency. No engine instrumentation or optimization is introduced.

## Recorded results

Windows x64, v24.2.0, release Wasm. Times are milliseconds per complete iterative search; node counts sum all completed depths. Cap/completed shows early termination when a forced result is found. These are one machine's measurements, not performance guarantees.

| Position | Cap/completed | Cached nodes | Cache on, ms | Cache off, ms | Cache cutoffs |
| --- | --- | ---: | ---: | ---: | ---: |
| one-stone opening | 7/7 | 194,014 | 186.617 | 256.362 | 7,856 |
| six-stone opening | 6/6 | 65,168 | 79.875 | 98.041 | 2,493 |
| 20-stone middlegame | 6/6 | 23,187 | 48.353 | 55.176 | 814 |
| 12-stone development | 6/6 | 54,243 | 84.800 | 113.225 | 2,246 |
| 32-stone tactical position | 6/1 | 1 | 0.017 | 0.016 | 0 |
| forced tactical replies (root bypassed) | 6/6 | 55 | 0.124 | 0.118 | 0 |

The four longer searches have these sampled shares. Sorting is included in candidate generation, so those columns must not be added together.

| Position | Candidate generation | Of total: sorting | Make/undo | Cache |
| --- | ---: | ---: | ---: | ---: |
| one-stone opening | 37.1% | 18.8% | 37.5% | 12.0% |
| six-stone opening | 49.6% | 27.0% | 30.7% | 9.2% |
| 20-stone middlegame | 63.6% | 37.1% | 23.2% | 5.9% |
| 12-stone development | 57.0% | 33.2% | 26.9% | 7.3% |

Samples use observed time deltas and relevant Rust call-stack ancestry, so categories do not overlap. The requested sampling interval is 100 microseconds; actual sampling frequency depends on the platform. Compiler inlining can attribute work to its caller, so these figures are approximate subsystem shares. Pattern classification and winning-cache refresh during make/undo are included in make/undo; the JSON also reports visible subcategories. The two runs of this experiment gave the same overall ranking.

## Optimization priorities

1. **Avoid sorting discarded candidates.** Candidate generation sorts the entire frontier before retaining 30/50 candidates (plus all tactical moves). Visible sorting consumes roughly 19?37% of total time in the longer cases. Select the retained subset first, then sort it with the existing total comparator. Preserve tactical retention, source-rank ties and the exact list used by search/PV ordering. Validate full candidate lists and search statistics against the reference.
2. **Reduce repeated generation work.** Density is rebuilt from occupied squares at every generated node. Measure maintaining density during make/undo against recomputation. Single mandatory replies may also bypass quiet candidate generation, with careful preservation of existing tactical ordering.
3. **Optimize make/undo.** It consumes roughly 23?37% in these longer cases. Investigate affected-score work and pattern classification after candidate improvements. Distinguish visible pattern/cache calls from work inlined into make/undo.
4. **Revisit the transposition table afterward.** Cache work accounts for approximately 6?12% here. Caching makes every longer sampled search faster (about 12?27% less elapsed time), while short no-hit tactical searches pay overhead. Profile evidence does not establish allocation counts or prove that replacing the table is the largest gain. Fixed PV copies, hashing and allocation remain candidates for targeted measurements.

Any change to move ordering must account for selective width limits: changing order can change which branches are searched. These first optimization proposals aim to preserve existing candidate lists, scores and PVs.

## Candidate subset selection

Implemented partial selection for frontiers larger than twice the retained count. Rust partitions with the original total comparator, then sorts only the retained candidates. Smaller frontiers still use the full sort because partitioning overhead can outweigh the savings. All tactical moves remain included.

A comparison against the prior release Wasm, with three warmups and eleven alternating timed runs, measured:

| Position | Depth | Before, ms | After, ms | Elapsed-time reduction |
| --- | ---: | ---: | ---: | ---: |
| One-stone opening | 7 | 183.1 | 185.0 | Approximately unchanged |
| Six-stone opening | 6 | 79.8 | 78.7 | Approximately unchanged |
| 20-stone middlegame | 6 | 45.4 | 39.2 | 14% |
| 12-stone development | 6 | 85.6 | 80.4 | 6% |

Every completed iteration matched the prior build exactly, including score, PV, nodes, cache hits, cutoffs and table size. Complete candidate lists also match the JavaScript reference across 4,628 board/color cases. These are Node-hosted measurements on this machine.

To compare future changes, save a baseline before editing Rust:

```powershell
New-Item -ItemType Directory -Force .profiles/candidate-sort-before
Copy-Item engine-rust/pkg/nodejs/* .profiles/candidate-sort-before/
# After changing the engine:
npm run wasm:compare
# Or supply another saved Node binding module:
npm run wasm:compare -- --baseline=.profiles/other-baseline/gomoku_engine.js
```

The saved directory must include the generated JS, Wasm and CommonJS package.json. Run wasm:build before taking a baseline if Node bindings are missing or stale. Comparison rebuilds the current engine, verifies every iteration against the saved baseline, and writes `.profiles/wasm-search-comparison.json`. Baseline binaries remain local and ignored by Git.

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
2. **Reduce repeated generation work.** Density maintenance is now implemented; see the measurements below. Single mandatory replies may also bypass quiet candidate generation, with careful preservation of existing tactical ordering.
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

## Incremental neighborhood density

Rust search and SearchState now initialize radius-two density counts once and reuse them for candidate generation. Ordinary make/undo updates at most 25 counts. Leaf and tactical-horizon moves deliberately skip density updates because those branches never generate candidates. Undo records whether counts were changed and restores the parent before candidate generation resumes. Candidate thresholds, priorities and source-rank ordering are unchanged.

Updating density on every leaf initially made the one-stone opening about 4% slower. Skipping those updates removed most of that cost. Against the previous partial-sorting build, three warmups and eleven alternating runs measured:

| Position | Depth | Before, ms | After, ms | Result |
| --- | ---: | ---: | ---: | --- |
| One-stone opening | 7 | 182.6 | 183.6 | Approximately unchanged |
| Six-stone opening | 6 | 77.9 | 77.7 | Approximately unchanged |
| 20-stone middlegame | 6 | 39.3 | 38.2 | About 3% less elapsed time |
| 12-stone development | 6 | 81.2 | 80.2 | Approximately unchanged |

These are modest differences on this Node-hosted sample, not a substantial speedup claim. Every iteration retains identical scores, PVs, nodes and cache statistics. Tests compare density with an independent square reference across 225 placements and their undos, edges, full-board counts, failed moves, stale tokens and leaf/horizon restoration. Full Wasm candidate/state/search parity checks also pass. Compare another saved build with `npm run wasm:compare -- --baseline=.profiles/density-before/gomoku_engine.js`.

## Direct mandatory-block selection

Rust search now retrieves a single mandatory block from the winning-square cache before candidate generation, provided there is no own immediate win. The normal make/undo, recursive depth, cache bounds, node counting and mate-distance handling remain unchanged. Multiple winning moves still use candidate ordering.

Saved-build comparisons now include a mandatory-block fixture and a forcing-chain fixture. The short forcing chain is timed in batches of 100 searches; the mandatory-block fixture uses batches of 20. All completed iteration values must match the baseline exactly. Against the density-maintenance build, three warmups and eleven alternating runs measured:

| Position | Depth | Before, ms | After, ms | Result |
| --- | ---: | ---: | ---: | --- |
| One-stone opening | 7 | 184.1 | 185.7 | Approximately unchanged |
| Six-stone opening | 6 | 77.4 | 77.5 | Approximately unchanged |
| 20-stone middlegame | 6 | 37.5 | 35.8 | About 5% less elapsed time |
| 12-stone development | 6 | 78.5 | 78.4 | Approximately unchanged |
| Mandatory block, then quiet search | 6 | 20.48 | 20.75 | Approximately unchanged |
| Forcing chain | 6 | 0.118 | 0.057 | About 2.1x faster |

The largest relative improvement is on the forced chain, whose absolute cost was already small. One block followed by quiet search does not yield a broad speedup. These are Node-hosted results. Run `npm run wasm:compare -- --baseline=.profiles/forced-block-before/gomoku_engine.js` with a saved prior build to reproduce. Native tests additionally check state/density/hash restoration and immediate-win precedence for both colors and multiple table capacities.

A follow-up one-second-per-position CPU sample of the optimized build still attributes roughly 36?54% of longer searches to candidate generation and 28?37% to make/undo. On the forcing chain, candidate generation falls to about 6%, with make/undo around 38%. These are approximate shares of a much shorter search; fixed construction and binding overhead become more visible. The profiler recognizes the new generate_with_density/place function names and reports candidate partitioning separately from sorting. Historical pre-optimization shares above remain tied to their original build.

## Precomputed pattern classification

Adopted a static table after comparison with the direct bitmask classifier. Cargo generates all 19,683 ternary configurations from the reference classifier. The first prototype used four-byte entries; the final table uses two-byte entries (39,366 bytes), plus a 512-entry mask-to-ternary index map. Runtime extraction continues to use shifts and masks on maintained line bitboards. Lookup replaces classification only; there is no runtime table construction. Public packed pattern results are unchanged.

Against the previous forced-block build, three warmups and eleven alternating runs measured:

| Position | Depth | Before, ms | After, ms | Elapsed-time reduction |
| --- | ---: | ---: | ---: | ---: |
| One-stone opening | 7 | 182.8 | 168.8 | 8% |
| Six-stone opening | 6 | 76.0 | 71.3 | 6% |
| 20-stone middlegame | 6 | 35.2 | 33.3 | 5% |
| 12-stone development | 6 | 77.5 | 72.9 | 6% |
| Mandatory block | 6 | 20.06 | 18.55 | 8% |
| Forcing chain | 6 | 0.057 | 0.051 | 10% |

Every completed iteration matches the prior build, including score, PV, nodes and cache statistics. Native tests compare all 262,144 mask pairs after blocker normalization, and Wasm tests cover all ternary configurations in every direction against JavaScript. Sampled timing improvements are Node-hosted; they do not establish browser latency.

The production Wasm asset grows from 125.11 KB to 164.83 KB, or 46.10 KB to 48.67 KB under Vite's gzip estimate: about 2.6 KB more compressed data. This does not measure cold download, compilation or initialization time. The larger asset is the tradeoff for reduced search time.

Saved-build comparison: `npm run wasm:compare -- --baseline=.profiles/pattern-before/gomoku_engine.js`. Source freshness checks include build.rs as well as the reference classifier so changes cannot silently use an outdated browser table.

## Direct search-width candidate selection

Search now selects its final 8?18-move quiet width directly from the frontier, retaining all tactical moves, then sorts only the selected prefix. Easy and diagnostic candidate generation continue to return the original 30/50 capped list. Small frontiers retain the full-sort path when partitioning is unlikely to help.

Previous-PV promotion still tests eligibility against the old generation cap. A PV move outside the narrow prefix but inside that cap replaces the same last quiet move; a move outside the old cap remains excluded. Winning-only selection and single mandatory blocks preserve their previous behavior. The legacy two-stage selector is compiled only for tests; 12,656 direct comparisons cover all PV squares (and no PV), depths 1/4/6/10, both colors, opening/dense boards, wins and blocks.

Against the previous compact-pattern-table build, three warmups and eleven alternating timed runs measured:

| Position | Depth | Before, ms | After, ms | Elapsed-time reduction |
| --- | ---: | ---: | ---: | ---: |
| One-stone opening | 7 | 170.5 | 154.7 | 9% |
| Six-stone opening | 6 | 71.9 | 60.3 | 16% |
| 20-stone middlegame | 6 | 33.3 | 28.4 | 14% |
| 12-stone development | 6 | 73.7 | 60.1 | 19% |
| Mandatory block, then quiet search | 6 | 18.77 | 16.55 | 12% |
| Forcing chain | 6 | 0.052 | 0.052 | Approximately unchanged |

Every iteration matches the saved build exactly: scores, PVs, nodes, cache hits, cutoffs and table size. These are Node-hosted measurements. Reproduce against a saved baseline with `npm run wasm:compare -- --baseline=.profiles/search-width-before/gomoku_engine.js`.

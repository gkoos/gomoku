# External engine baseline

Run our native engine against Rapfi using the downloaded `c-gomoku-cli` manager:

```powershell
npm.cmd run native:build
npm.cmd run external:match
```

The default is **100 games from 50 deterministic four-ply openings**, seed 43,
15×15 freestyle, alternating engine colors for each opening. Both engines use
depth 6 and one thread. Our engine uses its default handcrafted evaluation,
four tactical extension plies, and 32768 table entries. Rapfi loads the
configuration and evaluator beside its executable.

This compares strength at specified settings, **not equal thinking time**.
Depth has different meanings across engines. Our engine does not enforce clocks;
the manager's one-hour limit per move is a failure guard. Time forfeits, illegal
moves, crashes, and adjudicated draws are rejected rather than counted as board
results. Only independently replayed wins or full-board draws enter the report.

## Prerequisites and options

The default Windows paths are:

- `download/c-gomoku-cli.exe`
- `download/rapfi/pbrain-rapfi-windows-sse.exe`
- `engine-rust/target/release/pbrain-gomoku.exe`

Downloads and results are ignored by Git. See `download/README.md` and
`download/manifest.json` for the local packages and their provenance. The runner
does not download or rebuild engines automatically. It accepts other executable
paths, including native Linux/macOS builds. Engine paths must have no spaces or
quotes because of the upstream manager's command-string parsing.

Start with a small trial in a separate directory:

```powershell
npm.cmd run external:match -- --games=4 --output=.selfplay/external-rapfi-depth6-trial
```

To compare a different search setting against the same opening suite:

```powershell
npm.cmd run external:match -- --depth=8 --rapfi-depth=6 --output=.selfplay/external-rapfi-depth8
```

Use `--seed=N`, `--games=N` (positive and even), `--turn-seconds=N`,
`--manager=PATH`, `--engine=PATH`, and `--rapfi=PATH` to override defaults.
`--help` lists all options. Paths resolve relative to the repository root.

## Resume and artifacts

Repeat the exact command to resume. Completed pairs are checksum-verified,
replayed, and skipped. An incomplete pair is rerun from its opening; its SGF,
messages, and manager log are truncated before retrying because the manager
appends records. Completed games within an interrupted pair are repeated.

Settings, executable hashes, Rapfi configuration/weight hashes, and runner source
hash must match the saved `config.json`. Changed settings or binaries require a
new output directory. Run only one runner per output directory.

Each `pair-NNN/` contains:

- `opening.txt`: the opening in the manager's center-offset notation.
- `command.json`: the exact manager invocation and working directory.
- `games.sgf`: two full games with swapped colors and per-move times.
- `messages.txt` and `manager.log`: engine messages and manager diagnostics.
- `complete.json`: validated SGF checksum and pair wall-clock duration.

`report.json` is refreshed after every completed pair. It records win/draw/loss
counts, score, results by our color, mean/median/95th-percentile/maximum move
times, and full moves and timings. `lossesForReview` points to opening pairs and
colors for examining failures. Times are the manager's observed response times;
forced root shortcuts are included, and opening stones have no search timings.

Use the SGFs and saved moves to inspect losses before drawing conclusions about
which search or evaluation changes would help. A small score difference requires
more games and independent opening seeds before claiming an improvement.

## Game length comparisons

New match reports include `lengths`: mean, median, minimum, and maximum total
plies, played plies excluding the opening, and Gomoku moves. Wins, draws, and
losses are separate; losses also split by our color. A ply is one stone placement,
so two plies are approximately one turn for each player.

Compare saved runs without rerunning games or modifying their original reports:

```powershell
npm.cmd run external:lengths
```

Defaults compare the original baseline with the searched-defense rematch.
Override `--baseline=PATH`, `--current=PATH`, and `--output=PATH` for future runs.
The tool checks settings, opponent/manager hashes, game legality, matching
openings, and colors. It records input and analyzer checksums. Matched loss-length
deltas include only games lost in both runs; converted wins are reported
separately. This avoids mistaking a change in the set of losses for longer survival.

In the defensive-fix rematch, the 94 matched losses became longer in 23 cases,
shorter in 17, and stayed the same in 54. Mean change was **+0.26 plies** and
median change **zero**. Black's mean change was -0.23 plies; White's was +0.68.
There is little evidence of a substantial survival change in these games.

Length is a secondary diagnostic beside results and tactical fixtures. Delaying
an inevitable loss can lengthen a game without improving the chance of winning;
a stronger engine can also win faster. Avoid optimizing weights solely for length.

## Initial baseline, 2026-10-06

The default run completed all 100 games in approximately 87 seconds on this
Windows workstation, using Rapfi release 250615, version 0.43.01, Windows SSE41,
and its bundled mix9svq evaluator. Both engines were configured at depth 6.

| Our engine | Wins | Draws | Losses |
| --- | ---: | ---: | ---: |
| Black | 5 | 0 | 45 |
| White | 0 | 0 | 50 |
| Total | 5 | 0 | 95 |

| Observed move time | Gomoku | Rapfi |
| --- | ---: | ---: |
| Mean | 19.6 ms | 29.9 ms |
| Median | 12 ms | 28 ms |
| 95th percentile | 60 ms | 126 ms |
| Maximum | 656 ms | 221 ms |

All results were independently replayed and confirmed as legal freestyle wins;
none were forfeits, crashes, or adjudications. The initial four-game trial was
separate and is not included in these counts. Raw results are retained locally
at `.selfplay/external-rapfi-depth6/report.json` and its `pair-NNN/` directories.
Executable, evaluator, configuration, and runner hashes are in `config.json`.

Rapfi is substantially stronger under these settings. These results do not
establish equal-time strength or identify the cause of the gap. The next analysis
should examine lost positions and forcing sequences before choosing algorithm
changes; this baseline can then measure their effect on the same openings.

See the [loss analysis](external-loss-analysis.md) for rerunnable position probes,
a confirmed defensive-shortcut weakness, and the next tactical experiments.

## Continuous-four horizon follow-up

The same 100 games, openings, colors, depth-six settings and Rapfi assets were
replayed after adding side-to-move VCF probes at eligible quiet leaves. Root
VCF remained at 15 plies/2,048 nodes; horizon VCF used seven plies. These local
measurements compare complete moves, including changes in the searched tree.

| Version | Wins | Draws | Losses | Mean move time | Median | p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Root VCF only | 7 | 0 | 93 | 19.8 ms | 14 ms | 57 ms |
| Horizon VCF, 128 nodes | 11 | 0 | 89 | 63.6 ms | 35 ms | 243 ms |
| Horizon VCF, 32 nodes | 12 | 0 | 88 | 48.1 ms | 31 ms | 163 ms |
| Horizon VCF, 32 nodes + PVS | 12 | 0 | 88 | 32.0 ms | 22 ms | 100 ms |
| Protected four-creating attacks (current) | 11 | 0 | 89 | 10.5 ms | 7 ms | 35 ms |

The 32-node horizon/PVS version converted eight baseline losses into wins and three wins
into losses. All 12 wins were as Black. Among the 85 games lost by both versions,
42 lasted longer, 30 shorter and 13 unchanged; the mean difference was +1.74
plies and the median zero. White's matched losses gained 2.52 plies on average.
These are fixed-depth comparisons, not evidence of strength at equal thinking
time. Before attack protection, PVS took about 1.6 times the root-VCF baseline
mean move time.

Reports are saved locally under `.selfplay/external-rapfi-vcf-depth6/`,
`.selfplay/external-rapfi-vcf-horizon-depth6/` (128 nodes), and
`.selfplay/external-rapfi-vcf-horizon32-depth6/`. The current directory includes
`length-comparison.json` against root VCF. Reproduce the current match with
`node scripts/external-match.js --output=.selfplay/external-rapfi-vcf-horizon32-depth6`.
Build the native executable first; existing match directories can only resume
when their recorded binary and configuration hashes still match.

PVS preserved the exact move sequences of all 100 games against the 32-node
ordinary alpha-beta run, while reducing mean move time by 33.5%. Its reports are
under `.selfplay/external-rapfi-pvs-depth6/`, including `length-comparison.json`
and `pvs-comparison.json`. Reproduce the PVS-only match with
`node scripts/external-match.js --output=.selfplay/external-rapfi-pvs-depth6`.
These older directories record earlier binaries and cannot resume with the
current executable.

The same-artifact Wasm benchmark's depth-six opening fixture changed from
27,514 to 18,450 alpha-beta nodes and from 52.8 to 38.4 ms median move time with
identical score and PV. Two short tactical fixtures had essentially unchanged
timings; re-search can add nodes when the first move is poorly ordered. PVS
does not guarantee a speedup on every position. The rerunnable reference/PVS
switch is documented in the implementation guide.

## Protecting four-creating attacks

The next run retained four-creating attacks through both normal-search caps
and ranked them ahead of quiet candidates. Immediate wins and unique mandatory
blocks still take precedence. Search depths, evaluation and tactical budgets
were unchanged. Results are saved under `.selfplay/external-rapfi-forcing-depth6/`,
with `length-comparison.json` against the PVS-only run. Reproduce with
`node scripts/external-match.js --output=.selfplay/external-rapfi-forcing-depth6`.

The run finished at **11 wins / 89 losses**, compared with **12 / 88**: four
previous losses became wins and five wins became losses. Ten wins were as Black
and one as White. Among 84 games lost by both versions, 50 lasted longer, 25
shorter and nine unchanged; mean length change was **+3.26 plies**, median **+2**.
The Black mean was +5.54 plies and White +1.63. This sample does not demonstrate
a win-rate improvement, and longer losses do not establish improved strength.

Mean move time was **10.5 ms**, median **7 ms**, p95 **35 ms** and maximum
**123 ms**. Games take different routes and contain different proportions of
forced replies; these are whole-match timings, not a fixed-position speedup.
The same-artifact opening benchmark retained the same depth-six score and PV
with 17,593 rather than 18,450 alpha-beta nodes; median timing was 38.1 versus
40.4 ms. The two short tactical fixtures had similar timings. The benchmark's
`--forcing=off` and `--forcing=on` modes preserve rerunnable policy comparisons.

The [implementation guide](implementation.md#hashing-and-transposition-table)
describes the separate proof cache and rerunnable Wasm timing benchmark.

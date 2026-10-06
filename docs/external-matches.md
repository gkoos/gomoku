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

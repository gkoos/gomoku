# Native Gomocup/Piskvork engine

The native `pbrain-gomoku` executable uses the same root selection, incremental
evaluation, candidate generation, and search as the browser Wasm engine. It
communicates over stdin/stdout using the
[Gomocup/Piskvork protocol](https://plastovicka.github.io/protocl2en.htm).
Every reply is flushed; diagnostics go to stderr. The process retains the board
between turns and constructs fresh search state and a transposition table for
each move, as in the browser.

## Build and run

```powershell
npm.cmd run native:build
engine-rust/target/release/pbrain-gomoku.exe --depth=6
```

Linux/macOS use `pbrain-gomoku` without `.exe`. Only the native Rust toolchain
is needed; Python and the Wasm target/bindgen CLI are unnecessary. The binary
and Cargo build output are ignored by Git. Direct Cargo equivalent:

```text
cargo build --release --locked --manifest-path engine-rust/Cargo.toml --bin pbrain-gomoku
```

Options use `--name=value`:

| Option | Default | Allowed values |
| --- | ---: | --- |
| `--depth` | 6 | 1–10 iterative plies; searched mates can end earlier |
| `--extension` | 4 | 0–225 tactical horizon plies |
| `--table-capacity` | 32768 | 0–1,000,000 entries; zero disables caching |
| `--nnue` | None | Path to an experimental portable model |
| `--nnue-scale` | 1000 | Finite value from 1 to 100,000 |
| `--policy` | None | Path to an experimental `GOMPOL1` candidate-ordering model |
| `--policy-scale` | 1000 | Finite value from 1 to 100,000 |
| `--policy-plies` | 1 | Topmost plies that use the policy (1 = root only) |
| `--candidate-width` | Unset | Diagnostic fixed candidate cap from 1 to 225 |
| `--root-width` | Unset | Diagnostic root-only candidate cap from 1 to 225 |

The diagnostic width replaces the remaining-depth candidate cap at every search
node. Immediate wins, mandatory blocks, four-creating attacks and retained PV
moves keep their existing protection, so a node can exceed the requested cap.
The independent 30/50 generation cap remains in place. Omitting this option
preserves the production policy; browser difficulty settings are unaffected.

`--tier=1` enables an experimental ordering that promotes open-three-creating
moves (from the existing VCT threat scan) ahead of density-ranked quiet moves,
below immediate wins, mandatory blocks and four-creating attacks. It is a
diagnostic and off by default: over 100 games against Rapfi depth 6 it scored
12% on its own and 15% alongside the policy ordering, versus 17% for the policy
alone, so the threat tier does not beat the policy.

`--history=1` enables dynamic interior ordering from main history, countermoves
and killer moves (the root keeps its static/policy ordering). It is a diagnostic
and off by default: over 100 games against Rapfi depth 6 it scored 2% with
killers and countermoves and 3% with main history alone, versus the 12% baseline.
Search-derived history promotes a square that caused a cutoff in one branch to
the front of every other branch, displacing the density-ranked quiet moves the
narrow candidate cap depends on, so it is not used.

`--tt-move=1` makes every node try the transposition table's stored best move
first (the root keeps its existing PV promotion). It is a diagnostic and off by
default: over 100 games against Rapfi depth 6 it scored 10% alone and 16% with the
policy ordering, versus the 12% and 17% references, and it is **3.5x slower**
(mean 69 ms versus 20 ms per move). The promotion forces the entry's move into the
retained prefix at every hit, and a stored move is often a refuted fail-low move
rather than a good one, so the ordering only gets worse. It is not used.

`--initiative=K` (from -64 to 64, default 0) adds a tempo-aware term: the side to
move's open-three potential counts for an extra `K/16`. Positive `K` rewards the
mover's live potential (initiative); negative `K` rewards the opponent's forcing
shapes (defensive urgency). It is maintained incrementally per colour, and `K=0`
leaves the linear evaluator byte-identical. Against Rapfi depth 6, `K = 16`, `-16`
and `64` all score exactly the baseline 12% (12W/88L) while changing every game,
so the term is inert at the weights tested. See
[strategic loss diagnostic](strategic-diagnostic.md) for why the evaluation is
still the leading suspect.

`--mate-stop=0` lets iterative deepening continue past a mate-sized iteration
score. By default it stops at once (`done = depth >= max_depth || |score| >=
WIN_SCORE - 225`), and because every non-root node caps candidates at
`max(8, 20 - 2 * remainingDepth)` while protecting only immediate wins, blocks and
four-creating moves, a selectively-derived mate is not a certificate - the
[loss analysis](external-loss-analysis.md) already recorded a 999991 score
becoming -708 one ply deeper. Against Rapfi depth 6 the flag scores 13% (13W/87L)
versus the 12% baseline, so the unsound-mate effect is real but not dominant at
this depth. It is a diagnostic and off by default.

`--order-eval=N` orders quiet candidates by the **shallow evaluation of the
position after the move** instead of by the density priority, inserting that value
into the ordering key between the policy and the priority. `N` is 0 (off), 1
(every node) or 2 (root only). It is the fix for the bottleneck the
[strategic diagnostic](strategic-diagnostic.md) identified: retention was decided
by a density heuristic that kept Rapfi's move in its top eight only 36% of the
time, while the evaluation keeps it there 79% of the time. Against Rapfi depth 6
`N=1` scores **19%** (19W/81L) on seed 43 and **18%** (18W/82L) on seed 7, against
baselines of 12% and 11% and the root policy's 17% - the best result in the
project - at 216 ms per move; `N=2` scores 16% at 61 ms. Combining `N=1` with the
policy lowers the score to 15%, because the policy imitates our own (biased)
search choices. With it, depth finally pays: `--order-eval=1 --depth=8` scores 22%
against 19% for the same configuration at depth 6. It is opt-in; the default path
is unchanged.
`--root-width` overrides the candidate cap at the root only, leaving deeper nodes
on the depth policy, and is still bounded by the same 30/50 generation cap.

`--help` prints usage to stderr and exits. Handcrafted evaluation is the default.
Models are loaded and validated before reading protocol input. Use the scale
recommended by the model's training report; search-target training uses 10000.
Model paths are relative to the process working directory; absolute paths avoid
ambiguity when a match manager changes directories.

## Protocol

| Command | Behavior |
| --- | --- |
| `START 15` | Initialize an empty board; reply `OK` |
| `BEGIN` | Play first on an empty board; reply `x,y` |
| `TURN x,y` | Record the opponent move, calculate and record our reply |
| `BOARD` … `DONE` | Load a whole position and play; entries are `x,y,field` |
| `INFO max_depth N` | Set depth to 1–10, without replying |
| `INFO rule 0` | Select freestyle rules, without replying |
| `INFO timeout_turn 0` | Use the existing fast/Easy root selector |
| `RESTART` | Reset board and color; retain settings; reply `OK` |
| `TAKEBACK x,y` | Remove an occupied square; reply `OK` |
| `ABOUT` | Return engine name, version, and author metadata |
| `END` | Exit without replying, including during an unfinished `BOARD` |

Coordinates are zero-based: **x is column, y is row**; position is `y * 15 + x`.
`BOARD` field 1 means our stones and field 2 means the opponent's, regardless
of Black/White. Counts establish our absolute color and require it to be our
turn. Board entries may arrive in any order. Successful responses immediately
add our move to the stored board.

Malformed/duplicate entries, invalid coordinates, occupied moves, terminal
boards, and impossible turn counts return `ERROR`. Invalid board transactions
are drained through `DONE` and preserve the previous position. A successful
`BOARD` replaces the position and recomputes our color. Unknown commands return
`UNKNOWN`; unknown `INFO` keys are ignored. `INFO` never replies. Unsupported
rules or invalid depth settings are reported on the next move request and can
be corrected by another `INFO`.

## Match-manager setup and limitations

For the downloaded Rapfi and manager, see the [external-match runner](external-matches.md)
for paired openings, resumable runs, result validation, and timing reports.

This version supports **15×15 freestyle**, including overline wins. Other board
sizes, exact-five, Renju, Caro, blocked-square fields, Swap2, and continuous-game
commands are unsupported. This is compatibility for 15×15 freestyle matches,
rather than full Gomocup tournament compliance.

Search is synchronous and fixed-depth. Positive clock limits, node limits,
memory hints, and asynchronous stop/ponder commands are not enforced. An `END`
received during a search is processed after that search finishes. Use a generous
external clock limit and explicit depth for initial matches; the manager can
terminate an engine that exceeds its limit. Competitive clock-based benchmarking
requires subsequent time-control work. Browser behavior is unaffected.

[c-gomoku-cli](https://github.com/dhbloo/c-gomoku-cli) supports board size, rules,
paired openings, executable arguments, and the `INFO max_depth` extension.
With a separately installed Rapfi executable, an example is:

```text
c-gomoku-cli -each tc=0/3600 depth=4 -engine name=Gomoku cmd=./engine-rust/target/release/pbrain-gomoku.exe -engine name=Rapfi cmd=./external/rapfi/pbrain-rapfi.exe -rule 0 -boardsize 15 -games 20 -repeat -concurrency 1 -sgf matches.sgf
```

Adjust executable paths to your installation. External engines/managers are not
downloaded by our build/check commands. Depth has different meanings in different
engines, so equal depth gives repeatability rather than equal computational effort.

## Validation

```powershell
npm.cmd run rust:test
npm.cmd run native:check
```

Unit tests cover command sequencing, colors, axes, malformed input, transaction
recovery, resets, takebacks, terminal boards, and settings. `native:check` builds
the release binary, checks a live handshake while stdin stays open, and compares
52 native move responses with the committed Wasm engine: both colors, reversed
board-entry order, searched positions, resets, depth settings, and immediate wins.
The boards include the forcing-tempo defensive regression from the Rapfi match.
Test watchdogs only bound the harness. Wasm builds explicitly select `--lib`,
so the native executable is not built for browser output.

For experimental NNUE parity, add a model and scale to the check:

```powershell
npm.cmd run native:check -- --nnue=.training/nnue-search-depth6-v1/model.nnue --nnue-scale=10000
```

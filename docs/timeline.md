# Engine development timeline

A chronological record of what the Rust/Wasm engine tried, what each change was
worth, and whether it was kept. The other engine pages describe the **current**
state; this page is the history and the negative results.

Unless stated otherwise, strength is a deterministic 100-game match (50 paired
openings, seed 43, 15x15 freestyle) against **Rapfi depth 6**, run through
`scripts/external-match.js`. See [External matches](external-matches.md) for the
harness and [loss analysis](external-loss-analysis.md) for the diagnosis.
"d4/d6/d8" mean our engine's own search depth.

## Status legend

- **kept** - shipped in the engine (browser or native default behavior).
- **diagnostic** - merged but off by default; an experiment flag, not a default.
- **reverted** - merged and then undone.
- **not kept** - built and measured, but rejected or left experimental.

## Before the Rust/Wasm engine (2025-07-07 to 2026-10-05)

The original engine was pure JavaScript (`5c28463` initial commit onward). It
established the algorithms the Rust port later mirrored: bitboard candidate
neighborhoods (`2ff398b`), maintained line bitboards (`419757e`), incremental
evaluation (`8220da8`), Zobrist caching (`ec62668`), iterative deepening
(`e3b085f`), and an Expert ten-ply level (`174e0d5`). `fb28fc6` stopped treating
closed fours as threats. No external strength baseline was measured in this era,
so it is recorded here for context only.

## Phase 1 - Rust/Wasm foundation and ports (2026-10-05 to 10-06)

| Commit | Change | Result | Status |
| --- | --- | --- | --- |
| `e30d085` | Rust/Wasm foundation: bitboards, pattern classification, evaluation, parity vs JS | parity baseline for everything after | kept |
| `0050792` | incremental search state (line masks, winning caches, make/undo) | verified against JS | kept |
| `e99acb7` | candidate generation in Rust (row-mask shifts, priorities, ties) | parity | kept |
| `024f626` | Zobrist hashing + bounded transposition cache; alpha-beta in Rust | parity | kept |
| `f3efc40` | Wasm search wired into the browser worker (Medium/Hard/Expert) | JS fallback retained | kept |
| `1f5bbb3` | root selection and Easy scoring moved to Rust | parity | kept |

## Phase 2 - Search performance (profiling-driven, `docs/performance.md`)

| Commit | Change | Result | Status |
| --- | --- | --- | --- |
| `1aa5c37` | select retained candidates before sorting | visible sorting 19-37% to 4-5% of search time | kept |
| `8613c5a` | maintain neighborhood density in make/undo | faster candidate generation | kept |
| `6a5499f` | bypass candidate generation for mandatory blocks | faster forced replies | kept |
| `df2a5d5` | precomputed line-pattern classification tables | build-time tables, indexed lookups | kept |
| `92d9ce9` | select search-width candidates directly in Rust | less sorting | kept |
| `04cf775` | reuse maintained row bitboards for occupancy | ~1-2% less elapsed time | kept |

These are speed-only changes: scores, PVs, nodes and cache statistics stayed
identical, which made them safe to keep.

## Phase 3 - External baseline and tactical correctness (2026-10-06 to 10-07)

| Commit | Change | Result | Status |
| --- | --- | --- | --- |
| `fabb761` | native Gomocup/Piskvork executable | enabled all external matches | kept |
| `e54b4cf` | Rapfi match runner + tactical loss analysis | recorded the early depth-six baseline (the loss analysis covers its 95 losses) | kept |
| `b2dedf0` | defensive counterattacks; open-four replies before pruning | found the heuristic open-four shortcut ignored forcing tempo (pair 46); rematch 6/0/94 | kept |
| `284ed2f` | depth-seven experiment | inconclusive; difficulty depths unchanged | not kept |
| `877dd6e` | `--candidate-width` diagnostic | inconclusive controlled experiment | diagnostic |
| `388bcf8` | principal variation search | identical moves, **33.5% lower mean move time** | kept |
| `607503d` | aspiration windows in iterative deepening | 12/0/88 with a small mean-time reduction | kept |
| `559f57c` | bounded continuous-four (VCF) solver | verified winning lines | kept |
| `ed20692` | tactical horizon extended with cached VCF proofs | stronger horizon | kept |
| `35f4c6e` | protect four-creating attacks from candidate pruning | no more pruned fours | kept |
| `991e62c` | VCT solver with clean double-three detection | 12/0/88 vs 11/0/89 | kept |
| `739a239` | `--root-width` diagnostic | **12% to 15%** (width 8 to 50) at 2-6x time; narrowing deeper nodes instead **dropped to 6%** | diagnostic |

The tactical stack (VCF, VCT, forcible-move protection, searched defenses) is
what made the engine **tactically clean**: the loss analysis found no missed
immediate wins and no missed single mandatory blocks in any loss.

## Phase 4 - Evaluation experiments: weights, self-play, NNUE (2026-10-06)

| Commit | Change | Result | Status |
| --- | --- | --- | --- |
| `4d10a32` | self-play harness + configurable evaluation weights | infrastructure | kept |
| `3fa45e7` | batch weight experiments (shared opening pairs) | infrastructure | kept |
| `e797399` | "stronger twos" weight validation | 52.4% d4 / 51.7% d6; paired intervals include 50% | not kept (defaults unchanged) |
| `549959e` | self-play dataset export for learned eval | infrastructure | kept |
| `279ae58` | NNUE training + inference (452 inputs) | **21%** vs handcrafted at depth 4 - not competitive | not kept (experimental) |
| `be2b741` | NNUE inference inside Rust/Wasm | Python parity; default evaluator kept | diagnostic |

The first learned-eval attempt (raw-stone features, outcome labels) never beat
the handcrafted evaluator, so it stayed behind a flag.

## Phase 5 - Policy ordering: the one lever that worked (2026-10-07)

The loss analysis showed losses were positional, and the root-width sweep showed
the root was too narrow. Both point at candidate **ordering**: put the right quiet
move inside a narrow root instead of widening it. See
[nnue-policy-ordering.md](nnue-policy-ordering.md).

| Commit | Change | Result | Status |
| --- | --- | --- | --- |
| `5577b3d` | scope a policy net for ordering (ordering only, never in eval) | plan; headroom diagnostic | docs |
| `f40c078` | M1: offline policy re-ranker (teacher `pv[0]` labels) | teacher move top-8 **78.4% to 91.1%** vs handcrafted priority | kept (enabler) |
| `7475d98` | M2: portable `GOMPOL1` + Rust/JS/Python parity | 129,600 parity cases | kept |
| `f0b167b` | M3: apply the policy to **root** candidate ordering | **12% to 17%** (seed 43), 11% to 17% (seed 7); 11.5% to 17.0% over 200 games at 60-62 ms/move | **kept (best result)** |
| `981a1c9` | M4: `--policy-plies` interior ordering | interior (plies 2-3) **12-13%**; policy + wide root **11-14.5%** | diagnostic (root-only kept) |
| `56f2b66` | browser toggle to load the depth-6 model | UI | kept |
| `2e6db21` | auto-apply the policy; squares board | - | reverted (board look) |
| `eb9a724` | traditional board (stones on intersections) | UI fix | kept |

The browser now applies the policy automatically (`src/ai/config.js`,
`src/ai-worker.js`); only the squares look was reverted.

## Phase 6 - Learned evaluation v2, distillation, reductions, threat tier (2026-10-07)

Second wave, all targeting the same gap from different angles. Every one of these
either matched or lost to the 12% baseline.

| Commit | Change | Result | Status |
| --- | --- | --- | --- |
| `88ff9c1` | M5.1: pattern-histogram features + value net (65 -> 64 -> 1) | offline CE 0.594 vs 0.682 (old) / 0.693 (constant) | offline |
| `778b5e9` | M5.2: pattern value net as an alternative evaluator | **61.3%** vs handcrafted (200 self-play games) but **12%** vs Rapfi | diagnostic |
| `1a218af` | Rapfi-evaluation distillation labeler | fits offline (78.5%), 52% vs handcrafted, **12%** vs Rapfi | not kept |
| `ffb54e0` | Rapfi-move policy distillation | top-8 89.3% offline, **15%** vs Rapfi (worse than own 17%) | not kept |
| `7de9bae` | order-driven late-move reductions (`--lmr=4`) | **9%** at d6, **7.4%** at d8 | diagnostic (worse) |
| `a734b9f` | threat-tier open-three ordering (`--tier`) | **12%** alone, **15%** with the policy (`<17%`) | diagnostic (worse) |

Key observations:

- The pattern net is genuinely stronger at the **game** level (61.3% vs
  handcrafted) yet identical against Rapfi (12%): the evaluation gain does **not
  transfer** to the Rapfi matchup.
- **Reductions lose tactical lines.** Gomoku punishes a missed forcing line, so
  reducing late moves dropped the score even though it searched deeper.
- The **threat tier is neutral alone and worse combined**, because it outranks the
  policy at the root. This was the last untested "generate better moves" lever.

## Phase 7 - Dynamic ordering from the reference survey (2026-10-07)

Read the public classical engines (Rapfi, keonwoo98/Gomoku, SlowRenju, and the
CodeCup 2020 winner write-up) and implemented the most-cited untried lever:
dynamic interior move ordering. See the untried-lever survey below.

| Commit | Change | Result | Status |
| --- | --- | --- | --- |
| `cac1400` | main history + countermove + killer ordering at interior nodes (root keeps static/policy ordering) | **2%** vs the 12% baseline | diagnostic (worse) |
| (same build, diagnostics) | main history only, killers and countermoves zeroed | **3%** | diagnostic (worse) |

Both are catastrophic, so it is the history itself rather than the killers.
History rewards a square that caused a cutoff, then promotes that square at every
other node where it is a candidate; in a narrow candidate cap that displaces the
density-ranked quiet moves the search needs, and gomoku's threat structure makes
the promotion unsafe. Together with the interior-policy result (12-13%), the
conclusion is that our **static density ordering is already the best retention
function** available at interior nodes.

## Phase 8 - TT-move-first ordering (2026-10-07)

| Commit | Change | Result | Status |
| --- | --- | --- | --- |
| `6577207` | try the transposition table's stored best move first at every node | **10%** alone, **16%** with the policy (vs 12% / 17%), and **3.5x slower** (69 ms vs 20 ms mean) | diagnostic (worse) |

Forcing the entry's move into the retained prefix at every hit both displaces the
density ordering (many stored moves are refuted fail-low moves, not good ones) and
searches an extra candidate per node. Rejected.

## Phase 9 - Diagnosing the strategic gap, and a tempo-aware eval term (2026-10-07)

With the tactical axis confirmed solved, the next step was to find *where* the
quiet moves go wrong instead of guessing. See
[strategic loss diagnostic](strategic-diagnostic.md).

| Commit | Change | Result | Status |
| --- | --- | --- | --- |
| `cba5a54` | `scripts/external-match/strategic.js`: Rapfi as an oracle on our losses | we play Rapfi's own move 39% of the time; the first bad decision is positional in 57 of 95 games and arrives at ply 4-7 | kept (tool) |
| (same run) | eval-versus-search probe on the non-mate divergences | our own static eval prefers the wrong move in **58%** of them; the 1-ply search in 32% | finding |
| `cba5a54` | `--initiative=K`: tempo-aware eval term (the mover's open-three potential counts for K/16) | **12%** at K = 16, -16 and 64 - exactly the baseline - while changing every game | diagnostic (inert) |

The diagnostic is the actionable result: the strategic gap is **led by the
evaluation** (a plain linear sum with no initiative or tempo term), with candidate
retention responsible for about a third of the divergences.

## Phase 10 - Tracing the origin: are our mate scores sound? (2026-10-07)

The observation that every Rapfi-style search technique makes us *worse* points
at a missing substrate rather than a missing feature. The first candidate was
soundness: iterative deepening ends the instant any iteration returns a
mate-sized score, while every non-root node caps its candidates at
`max(8, 20 - 2 * remainingDepth)` and protects only immediate wins, blocks and
four-creating moves. A selectively-derived mate is therefore not a certificate.

| Commit | Change | Result | Status |
| --- | --- | --- | --- |
| `--mate-stop=0` | keep iterating past a mate-sized score so a deeper iteration can refute it | **13%** (13W/87L) versus the 12% baseline | diagnostic (wash) |

The mechanism is real (the loss analysis already recorded a 999991 score becoming
-708 one ply deeper) but disabling the early stop changed one game, so unsound
mates are not the dominant effect at depth six. The flag is retained.

## Phase 11 - Fixing the retention filter (2026-10-07)

The diagnostic said the bottleneck was retention, not depth and not the evaluation
itself. The fix is to order candidates by the shallow evaluation of the resulting
position instead of by density.

| Commit | Change | Result | Status |
| --- | --- | --- | --- |
| `1b43ef7` | `--order-eval=1`: each quiet candidate carries the shallow evaluation of the position after it, inserted into the ordering key between the policy and the density priority | **19%** (19W/81L) on seed 43 and **18%** (18W/82L) on seed 7, against 12% and 11% baselines, at 216 ms per move - the best result in the project | kept (opt-in) |
| (same change) | `--order-eval=1` combined with the root policy | 15% - the policy drags it back | finding |

After the root policy, this is the first lever to beat the baseline, and it beats
the policy (17%). The gap holds on both seeds (12% to 19% and 11% to 18%, about
+7 points), so it is not seed noise. It also completes the diagnosis: the accepted
moves were chosen by a density heuristic that ranks the true move in its top eight
only 36% of the time, while the evaluation ranks it there 79% of the time. Adding
the policy instead lowers the score, consistent with the policy imitating our own
(biased) search choices while the evaluation ranks Rapfi's move better.

## Results summary (vs Rapfi depth 6, 100 games, seed 43)

| Configuration | Score |
| --- | ---: |
| Baseline (handcrafted evaluation, depth 6) | 12% |
| **Shallow-evaluation candidate ordering (`--order-eval`)** | **19%** / 18% (2 seeds) |
| Root policy ordering | 17% |
| Root width 50 (2-6x slower) | 15% |
| Rapfi-move policy distillation | 15% |
| Shallow-evaluation ordering + policy | 15% |
| Threat tier **with** policy | 15% |
| Pattern value net / Rapfi-eval distillation | 12% |
| Threat tier alone | 12% |
| Depth 8 | 10% |
| LMR (start 4) depth 6 / depth 8 | 9% / 7.4% |
| Dynamic ordering, history only | 3% |
| Dynamic ordering, history + countermove + killer | 2% |
| TT-move-first ordering | 10% |
| TT-move-first ordering + policy | 16% |
| Initiative eval term (`--initiative`, ±16 and 64) | 12% |
| Mate-stop disabled (`--mate-stop=0`) | 13% |

Other opponents at our default depth 6: PentaZen 0.4.18 **1%** (1 s/move) and
**9%** (0.1 s/move); TITO 2014 **4%** (1 s), **25%** (10 ms), **66%** (3 ms).
Self-play evaluation comparisons: pattern net **61.3%** vs handcrafted, first
NNUE **21%** (depth 4), "stronger twos" weights **51.7-52.4%** (intervals include
50%).

## Kept vs thrown away

**Kept:** the Rust/Wasm port and its parity suites; the profiling-driven speed
work; PVS, aspiration windows, TT, iterative deepening; the tactical stack (VCF,
VCT, tactical horizon, forcible-move protection, searched defenses); the native
Gomocup executable and the external-match/loss-analysis harness; the **root policy
ordering (12% to 17%)** with the portable `GOMPOL1` format; and the
**shallow-evaluation candidate ordering (`--order-eval`, 12% to 19%/18%)**, the
best result and the fix for the retention bottleneck. The browser uses a
traditional board and applies the policy automatically.

**Reverted or not kept:** every evaluation change (weight tuning, outcome NNUE,
search-target NNUE, pattern value net, Rapfi-eval distillation); interior
ordering (policy and dynamic history); LMR; the threat tier; depth seven; and the
squares board look.

**Diagnostics (merged, off by default):** `--root-width`, `--candidate-width`,
`--policy`, `--policy-plies`, `--pattern`, `--pattern-scale`, `--lmr`, `--tier`,
`--history`, `--tt-move`, `--initiative`, `--mate-stop`, `--order-eval`.

## What the evidence says

- **Only root candidate ordering beat the baseline.** Five evaluation variants,
  deeper search, a wider root, LMR, the threat tier and Rapfi distillation were
  all neutral or worse.
- The engine is **tactically clean**: no missed immediate wins and no missed
  single mandatory blocks in any analyzed loss. Losses are quiet, positional and
  tempo failures that end in an unanswerable fork.
- **The evaluation gap does not transfer.** A net that wins 61.3% of self-play
  games scores the baseline 12% against Rapfi.
- **Rapfi's move is already in our candidate list about 92-95% of the time**, so
  generation is not the bottleneck - *choosing* among the candidates is.
- Diagnosis: our tree is "wide but wrong". The candidate cap is a fixed
  `max(8, 20 - 2 * remainingDepth)`, ordering is static, and no evaluation-driven
  pruning/singular-extension exists.

## Where the remaining headroom is: strategy, not tactics

Threat-space search is already implemented: `vcf.rs` (continuous fours) and
`vct.rs` (continuous threes and double threats, with a double-three/forbidden
check) run at the root (15 ply / 2048 nodes) and at the tactical horizon (7 ply /
32 nodes) with cached proofs. The loss analysis confirms the engine is
**tactically clean** - no missed immediate wins and no missed mandatory blocks in
any loss. Every loss is quiet, positional and tempo related and ends in an
unanswerable fork.

So the tactical axis is covered. Proof-number search, deeper VCF/VCT, more threat
tiers (Phase 6) and threat-driven ordering all act on a part of the game we
already solve.

The gap is **strategic**: choosing the right quiet move several plies before the
fork. On that axis only one thing has ever worked - re-ranking the root's quiet
candidates with the learned policy (12% to 17%). Every other intervention
(evaluation variants, interior ordering, reductions, breadth) is neutral or worse.

Two structural facts bound the options:

- The evaluation is a plain linear sum of per-stone pattern contributions for one
  side minus the same for the other (`evaluation.rs`). It has no defensive
  urgency, initiative or tempo term, so "the opponent has an open three we must
  answer" scores exactly the same as "we have one".
- Learned evaluation has transferred poorly: a pattern value net that wins 61.3%
  of self-play games still scores the baseline 12% against Rapfi.

Candidate **strategic** levers. The structural-evaluation one was tried as
`--initiative` and is inert (Phase 9); the diagnostic that preceded it is the page
to read first.

| Lever | Why it targets strategy (not tactics) |
| --- | --- |
| Sharpen the root policy with full-ranking / listwise targets instead of `pv[0]` only | improves the one lever that works, on quiet-move choice |
| ~~Structural evaluation: defensive-urgency / initiative term~~ | tried: `--initiative` is inert; the eval is still the leading suspect |
| Opening book for Black | nearly all our wins are Black; the opening decides those games |
| Bigger learned positional model (features, capacity, data), or a deeper eval probe on the flagged positions | only worth it with an external objective, not self-play or label-fitting |

Remaining **search-side** ideas from the survey (these prune, they do not add
strategic knowledge): Rapfi's futility/razoring/null-move margins and log LMR LUT
(`search/ab/parameter.h`), and `policyPruningScore`/`policyReduction`. They belong
behind a default-off flag and are measured against Rapfi depth 6, exactly like
`--lmr`, `--tier`, `--history` and `--tt-move` above.




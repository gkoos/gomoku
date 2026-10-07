# Policy network for candidate ordering

This scopes the smallest useful step toward the neural component that the strong
engines rely on: a **policy network used only to order candidates**, never added
to the evaluation. It attacks the one weakness the external matches isolated -
quiet-move ordering near the root - deterministically and cheaply enough for the
browser.

## Why ordering, not evaluation

Three experiments established the lever:

- **Evaluation tuning is exhausted.** VCT, aspiration, and every threat-count
  evaluator variant scored at or below the 12% baseline. The handcrafted eval is
  not the ceiling.
- **Breadth helps but is expensive.** A wide root rose monotonically from 12% to
  15% (root width 8 to 50), but cost 2-6x the time because each extra root move
  carries a full-depth subtree. See [external matches](external-matches.md).
- **The loss signature is positional.** Against Rapfi and PentaZen there are no
  missed wins and no missed blocks; every loss ends in an unanswerable fork.

So the gain is available if the **right quiet move reaches a narrow root**. A
per-move policy score can rank the quiet candidates so the strong move survives
the cap without widening it - the cheap half of the wide-root gain.

### Initial headroom check (offline)

The teacher labels already on disk (`.selfplay/nnue-teacher-depth6-v1`) answer the
cheapest M1 question: how well does the handcrafted ordering rank the move the
depth-six search itself chooses? Over the 2,742 validation positions:

| Measure | Value |
| --- | ---: |
| Teacher move is rank 0 | 28.6% |
| Teacher move is top-3 | 43.5% |
| Teacher move within top-8 | 78.4% |
| Mean rank of the teacher move | 4.34 |
| Teacher move is tactical (always protected) | 19.7% |
| Quiet teacher move outside top-8 | 26.8% of quiet |

The handcrafted priority is a weak ranker: the deeply-searched best move sits at
rank 0 only 28.6% of the time, and **21.6% of all positions have it outside the
top-8** (all quiet moves, since tactical moves are promoted to the front). That is
the headroom a learned ranker could attack, and it lines up with the root-width
finding - those out-of-rank moves are exactly the ones a wider root rescues.
Reproduce with `.selfplay/policy-rank-diagnostic.mjs`. This measures agreement
with the teacher, not strength: it shows ordering headroom exists, not that a net
can capture it.

## What a minimal version is

- **Per-move re-ranker, not a board evaluator.** Input is the board plus one
  candidate square; output is a scalar used only in the `compare` ordering key.
- **Tactics stay dominant.** Immediate wins, mandatory blocks, four-creating
  attacks and PV moves keep their existing precedence; the net only orders the
  quiet remainder.
- **Deterministic.** A pure function of `(black, white, sideToMove, position)`
  with fixed weights; no randomness, no RNG, no wall-clock. Cached == uncached.
- **Used for ordering only.** The score must never enter the evaluation, which is
  exactly the double-counting trap that sank the threat-eval experiment.

## Training signal

The relabeler already runs a fixed depth-six teacher on every sampled position
(`scripts/selfplay/teacher.js`) and stores `teacherSearch.pv` - the principal
variation. Its first element, `pv[0]`, is the move the search actually picked:
a free **move-ordering label** for the board before that move.

Milestone 1 uses this directly, with no teacher changes:

- **Positive:** `pv[0]`.
- **Negatives:** the other candidates the engine generates at that position
  (bounded to the quiet set, so tactical moves are excluded from both sides).
- **Loss:** a listwise/contrastive ranking loss (softmax over the candidate set)
  or logistic pairwise loss against the current ordering.

Capturing the **full root ranking** (every root candidate with its score) would
let the net learn the whole preference order, not just the top move. That is a
larger change to the teacher's WASM interface and is deferred to milestone 4.

## Features (per candidate move)

The 452-feature NNUE is board-global and cannot distinguish two empty squares, so
a policy needs **move-relative** features. Keep the vector small and cheap:

| Group | Examples | Width |
| --- | --- | ---: |
| Local runs | own/opponent stone counts within radius 2, along the four lines through the square | ~16 |
| Handcrafted priority | the existing `priority` value, normalized | 1 |
| Density / center | neighborhood density, center bonus | 2 |
| Tactics | `tactical` class (0/1/2); creates/blocks a four or three | ~4 |
| Source ordering | the generation `rank` (offset order) | 1 |

Including the handcrafted `priority` as an input lets the net only **improve** on
the current heuristic rather than relearn it, and gives a natural control: a
zeroed net must reproduce today's ordering exactly.

## Architecture

Small and quantizable, mirroring the existing NNUE module
(`training/nnue/model.py`):

- `input (D ~24-32) -> hidden (64-128, clipped-ReLU) -> 1 logit`.
- Optional softmax over the candidate set for the listwise loss.
- First version exports float32 like the current NNUE (`GOMNNUE1`); int8
  quantization for Wasm speed is a later optimization (Rapfi quantizes).

## Integration (Rust + JS parity)

Ordering lives in two mirrored places that must stay byte-identical:

- `engine-rust/src/moves.rs` - `Candidate.priority`, `compare`,
  `compare_with_forcing`, `finish`, `generate_ranked`.
- `src/ai/moves.js` - `generateCandidateMoves` sort key.

The net inserts a policy score into the ordering key, below `tactical` and above
the handcrafted `priority` (or replacing `priority` when a policy is active):

```text
compare = tactical desc, then forcing desc, then policy desc, then priority desc, then rank asc
```

New pieces, following the NNUE pattern:

- `engine-rust/src/policy.rs` - portable loader + per-move `score(...)`, with a
  new header (`GOMPOL1`) and validated dimensions/length, like `nnue.rs`.
- `src/ai/policy.js` - the JS twin for browser parity.
- `--policy=path` and `--policy-scale=N` on the native CLI (`protocol.rs`,
  `bin/pbrain-gomoku.rs`), plus `set_policy` on `SearchEngine` (`search.rs`),
  locked before the first search step exactly like `set_candidate_width`.
- `engine-rust/src/lib.rs` and the Wasm artifact export the new module.

No new randomness and no change to the default path: with no policy the engine is
byte-identical to today.

## Where it plugs in

1. **Root first.** Reorder the root shortlist by policy so the good quiet move
   enters the current width-8 root. This is the direct target of the root-width
   finding and the cheapest place to measure a benefit.
2. **Interior (later).** Order the top-K at every node so alpha-beta prunes
   earlier; only then consider a modest width increase, since better ordering
   makes added breadth cheaper.

## Milestones (each is independently useful)

| # | Deliverable | Gate to proceed |
| --- | --- | --- |
| M1 | Export `(board, pv[0])` labels; train a policy re-ranker in `training/nnue/`; measure offline ordering metrics | Policy beats the handcrafted `priority` on held-out top-1 / top-8 hit rate |
| M2 | Portable `GOMPOL1` format + `policy.rs` + `policy.js` + synthetic parity tests | Rust == JS == Python on all placements and both sides |
| M3 | Wire into the root ordering behind `--policy`; run 100-game matches | Beat the 12% baseline without slowing the search; `rust:test`/`npm test` green |
| M4 | Interior ordering, optional width increase, full-root-ranking teacher | Match gain holds on two seeds at default compute |

M1 is pure offline work with **no engine change**, so it is a clean go/no-go. If
the policy cannot out-rank the handcrafted priority on validation, stop - the
architecture is not worth the parity and latency cost.

## M1 result (offline ordering)

Trained the 25-feature re-ranker (`training/nnue/policy_train.py`) on the
depth-six teacher labels and evaluated on the disjoint validation split
(`.selfplay/policy-dataset-v1`). Candidates are the generator's own list stored
in handcrafted order, so the handcrafted baseline is just the stored index and
`target` is the teacher's `pv[0]`.

| Split | Metric | Handcrafted | Policy |
| --- | --- | ---: | ---: |
| All (2,742) | top-1 | 28.6% | **44.8%** |
| All | top-8 | 78.4% | **91.1%** |
| All | mean rank | 4.34 | **2.30** |
| Quiet (2,202) | top-1 | 11.1% | **31.6%** |
| Quiet | top-8 | 73.2% | **89.0%** |
| Quiet | mean rank | 5.41 | **2.87** |

The policy clears the gate by a wide margin: it lifts the teacher's own move into
the top-8 from 78.4% to 91.1% (quiet-only 73.2% to 89.0%) and nearly triples the
quiet top-1 rate. The handcrafted `priority` really is a weak ranker and a small
net improves it.

This measures agreement with the depth-six handcrafted teacher, not playing
strength; the gain only matters if it survives the M3 match. Reproduce:

```powershell
node scripts/export-policy-dataset.js --input=.selfplay/nnue-teacher-depth6-v1 --output=.selfplay/policy-dataset-v1
node scripts/run-nnue.js policy_train --dataset=.selfplay/policy-dataset-v1 --output=.training/nnue-policy-v1 --epochs=40 --seed=42 --threads=2
```

## Evaluation plan

- **Offline (M1):** top-1 accuracy, top-8 hit rate, and mean reciprocal rank of
  `pv[0]` under the policy vs under the handcrafted `priority`, on the disjoint
  validation split. This is the primary decision metric.
- **Online (M3+):** the existing `scripts/external-match.js` harness against
  Rapfi depth 6 (seeds 43 and 7) and self-play vs the committed baseline. Success
  bars: exceed 12% at default root width and default speed; approach the 14-15%
  of a wide root without its cost.
- **Invariants:** determinism (cached == uncached), the 45 Rust and 267 JS tests,
  the native/Wasm parity checks, and all existing fixtures must stay green with
  no policy loaded.

## Risks and limits

- **Ordering helps only if the target move is currently just outside the cap.**
  If `pv[0]` is usually already in the root shortlist, the ceiling is small. M1's
  "how often is `pv[0]` outside the width-8 root" is the key diagnostic.
- **Per-candidate cost.** The net runs for every quiet candidate at every node
  it is enabled. It must be cheaper than the nodes better ordering prunes.
- **Triple parity.** Features must be computed identically in Python, Rust, and
  JS. Reuse the existing symmetry/permutation test style.
- **Overfitting to the teacher.** The label is a depth-six handcrafted search,
  not perfect play; a policy can imitate its blind spots. Deeper teachers and the
  full root ranking (M4) mitigate this.
- **No calibration claims.** Do not read the policy logit as a score; it is only
  an ordering key.

## Files

New:

- `docs/nnue-policy-ordering.md` (this file)
- `training/nnue/policy_model.py`, `training/nnue/policy_train.py`
- `engine-rust/src/policy.rs`, `src/ai/policy.js`
- parity/unit tests for the policy loader and per-move score

Modified (mirrored in Rust and JS):

- ordering: `engine-rust/src/moves.rs`, `src/ai/moves.js`
- search wiring: `engine-rust/src/search.rs`, `src/ai/search.js`
- CLI: `engine-rust/src/protocol.rs`, `engine-rust/src/bin/pbrain-gomoku.rs`
- module exports: `engine-rust/src/lib.rs`, `src/ai/engine.js`, `src/ai/config.js`
- pipeline: `scripts/export-dataset.js` / `scripts/selfplay/teacher.js` (M4),
  `package.json` scripts

## Commands (mirroring the existing NNUE workflow)

```powershell
# M1: label and train offline (no engine change)
npm.cmd run nnue:relabel -- --dataset=.selfplay/nnue-dataset-v1-balanced --output=.selfplay/nnue-teacher-depth6-v1 --depth=6 --seed=42
npm.cmd run nnue:train -- --dataset=.selfplay/nnue-teacher-depth6-v1 --target=policy --output=.training/nnue-policy-v1 --epochs=40 --seed=42 --threads=2

# M3: match with the policy active
npm.cmd run native:build
node scripts/external-match.js --policy=.training/nnue-policy-v1/model.policy --policy-scale=1000 --output=.selfplay/external-rapfi-policy-depth6
```

The default engine path is untouched until `--policy` is supplied, so this work
can land incrementally without changing browser behaviour or existing results.

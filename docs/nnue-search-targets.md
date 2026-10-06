# Training NNUE from stronger searches

This experiment changes the training targets while retaining the first model's
452-input, 64-hidden-unit architecture, dataset positions, group split, training
seed, and optimizer. The original model learned empirical game outcomes from
shallow self-play. The new model learns scores produced by a consistent
depth-six handcrafted teacher. The game still uses its handcrafted evaluator.

## Generate teacher labels

```powershell
npm.cmd run nnue:relabel -- --dataset=.selfplay/nnue-dataset-v1-balanced --output=.selfplay/nnue-teacher-depth6-v1 --depth=6 --seed=42
```

The teacher uses `SearchEngine` directly. This bypasses heuristic root shortcuts
that lack a searched score, uses the actual side to move as its perspective,
and completes iterative search to the requested depth. It retains the existing
selective candidate generation, bounded tactical horizon, and default static
weights. A searched mate may finish at an earlier depth. These are engine
estimates rather than perfect-play labels.

The source dataset's positions, outcomes, old search labels, and group assignments
are preserved. Each row gains `teacherSearch`, containing score, completed and
requested depths, mate/evaluation classification, principal variation, node
count, teacher engine digest, and evaluation weights. The new manifest records
the source manifest hash, relabeler hash, configuration, and output hashes.

`labels.jsonl` saves each completed position immediately. Repeat the same command
to resume or regenerate identical final files. Changed inputs, configuration,
or relabeler code require a new output directory. An incomplete final journal
record must be repaired before resuming; concurrent writers are unsupported.
The final training manifest is written only after all selected labels finish.

For a quick experiment, `--train-limit=4096 --validation-limit=1024` selects
positions by a deterministic seeded hash within each existing split. The default
limit of zero labels the entire split. Selection cannot move related positions
across splits. The recorded experiment uses the entire dataset.

## Train and verify

```powershell
npm.cmd run nnue:train -- --dataset=.selfplay/nnue-teacher-depth6-v1 --output=.training/nnue-search-depth6-v1 --target=search --score-scale=10000 --epochs=40 --seed=42 --threads=2
npm.cmd run nnue:train -- --dataset=.selfplay/nnue-teacher-depth6-v1 --output=.training/nnue-outcome-depth6-control-v1 --target=outcome --epochs=40 --seed=42 --threads=2
npm.cmd run nnue:wasm-check -- --model=.training/nnue-search-depth6-v1/model.nnue --positions=.selfplay/nnue-teacher-depth6-v1/validation.jsonl
```

Training requires a new output directory. For a repeat run, change `--output`
and keep the remaining parameters fixed; relabeling itself supports resume.

For ordinary scores the target is `sigmoid(score / 10000)`. Positive searched
mates receive 1 and negative mates receive 0. Scores already describe the side
to move, so no color-based sign reversal is applied during training. Binary
cross-entropy fits these soft targets. Optional `--outcome-weight=0.25` blends
25% empirical outcome with 75% search target; the recorded experiment uses pure
search targets, the default weight of zero. Outcome-only training remains the
default when `--target` is omitted.

At inference use `--nnue-scale=10000` to convert model logits back to the same
score scale. The report and checkpoint record target configuration, and the
report supplies `recommendedLogitScale`. Search-target validation loss measures
agreement with the teacher and cannot be compared directly with outcome-target
loss from the first experiment. `outcomeValidation` provides a separate
diagnostic against the original outcome labels. Neither metric establishes
playing strength.

An outcome-only control is trained from the relabeled files as well. This keeps
position order and the seeded augmentation sequence aligned with the
search-target model; relabeling's seeded ordering differs from the original
export's order. Checkpoint selection still follows each run's own target loss.

## Paired matches and overlap checks

```powershell
npm.cmd run selfplay -- --games=100 --depth=4 --seed=41 --nnue-b=.training/nnue-search-depth6-v1/model.nnue --nnue-scale=10000 --output=.selfplay/nnue-teacher-comparison/search-seed41.jsonl
npm.cmd run selfplay -- --games=100 --depth=4 --seed=42 --nnue-b=.training/nnue-search-depth6-v1/model.nnue --nnue-scale=10000 --output=.selfplay/nnue-teacher-comparison/search-seed42.jsonl
npm.cmd run nnue:match-report -- --input=.selfplay/nnue-teacher-comparison/search-seed41.jsonl --input=.selfplay/nnue-teacher-comparison/search-seed42.jsonl --dataset=.selfplay/nnue-dataset-v1-balanced --output=.training/nnue-search-depth6-v1/matches.json
```

For comparison, run the same seeds and depth with
`.training/nnue-outcome-v1-repeat/model.nnue`, first at scale 10000 to match the
new score conversion, and then at its original experimental scale 1000. Use
different output filenames. Passing all six files to `nnue:match-report` groups
results by model, scale, depth, and teacher engine. Every opening pair swaps
colors. Saved models and game records remain local, ignored artifacts.

Also run `.training/nnue-outcome-depth6-control-v1/model.nnue` on the same seeds
at scale 10000 for the matched training control. The handcrafted-versus-itself
control uses the same self-play commands with both NNUE options omitted.

The report checks game legality, paired openings, the handcrafted baseline,
source hashes, and teacher identity. It separately counts games whose canonical
opening is absent from every original dataset source, including validation
games, and games that reach a sampled training position. Original source match
files referenced by the dataset manifest must still be available. Opening
novelty does not prevent later transpositions; those counts should accompany
results. Duplicate canonical openings remain in the game totals and are
reported explicitly. These experiments do not establish a calibrated Elo gain.

## Recorded result

The full corpus contains 12,541 training and 2,742 validation positions,
preserving all original rows and splits. Relabeling searched 628,228,553 nodes
in approximately 584 seconds. It produced 3,281 mate labels; 12,591 positions
completed depth six, while 2,692 ended earlier on searched mates. Both colors
remain represented: 7,671 Black-to-move and 7,612 White-to-move positions.

The search-target model selected epoch six and stopped at epoch 14. Validation
cross-entropy against its search targets was 0.687308, versus a constant-target
baseline of 0.693150; Brier error was 0.054067 versus 0.056977. Its outcome-label
diagnostic cross-entropy was 0.681903. The matched outcome control selected
epoch five and achieved 0.681680 against outcome labels. The model learns some
signal, but these measurements do not demonstrate useful move selection.

Two identical search-target runs produced identical 116,252-byte models,
SHA-256 `2bb3f74d62a14c304fba274b9fcbf288b7e911140509f334e788005efd2cd44b`.
The teacher dataset manifest SHA-256 is
`ce6857596f4bba35e8eb043fe54f48185f97f7193539cae61bdc2a72a56fb8b5`.
Rust/Wasm inference matched Python on 1,024 evaluations with maximum probability
error 2.41 × 10⁻⁸. The matched outcome-control model SHA-256 is
`fbf77c81a069f9b556885159e8417450f7ccb6acbc3f6dcf51eb48d46947c023`.

Each configuration below played 200 depth-four games against the default
handcrafted engine, using seeds 41 and 42 with colors swapped per opening.
There were 99 distinct canonical openings across the 100 pairs. Of those,
70 openings were absent from every original dataset source, leaving 140 games
in the unseen-opening subset. All NNUE models used the same shared root tactics
and search as the baseline.

| Candidate | Logit scale | Wins / draws / losses | Score | Unseen-opening score |
| --- | ---: | --- | ---: | ---: |
| Search-target NNUE | 10,000 | 34 / 0 / 166 | 17.0% | 18.6% |
| Matched outcome control | 10,000 | 29 / 0 / 171 | 14.5% | 13.6% |
| Original outcome NNUE | 10,000 | 42 / 2 / 156 | 21.5% | 20.7% |
| Original outcome NNUE | 1,000 | 38 / 2 / 160 | 19.5% | 18.2% |
| Handcrafted against itself | — | 100 / 0 / 100 | 50.0% | 50.0% |

The search-target model visited a sampled training position in 35 games; the
matched outcome control did so in 36. This includes games with known openings
and later transpositions. The overlap report is saved in
`.training/nnue-search-depth6-v1/matches.json`; all ten match files are in
`.selfplay/nnue-teacher-comparison`. The new models, repeat run, and training
reports are in their respective `.training` directories.

The observed 2.5-point difference from the matched outcome control is not
enough to establish a strength gain. Both models remain far weaker than the
handcrafted engine, and the original outcome model scored higher in this suite.
Deeper targets alone did not make this architecture competitive. The next
experiment should examine whether its features and capacity can represent
local threats accurately, using tactical validation and controlled matches,
before investing in substantially more relabeling. This result does not prove
that NNUE or search-target training cannot improve the engine.

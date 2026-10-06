# Self-play datasets for learned evaluation

For consistent deeper labels on an existing dataset, see the
[stronger-search NNUE experiment](nnue-search-targets.md). Its relabeler preserves
the existing split and adds independently searched teacher scores.

The exporter reconstructs training positions from version-1 self-play JSONL files. It requires only Node; it does not run engine searches. The dataset is a starting point for an NNUE experiment, with sparse stone locations and labels independent of any particular network architecture.

```bash
node scripts/export-dataset.js --input=.selfplay/stronger-twos-validation-depth4 --input=.selfplay/stronger-twos-validation-depth6 --output=.selfplay/nnue-dataset-v1-balanced --stride=4 --seed=42 --validation=0.2
```

`npm run selfplay:export -- ...` is also available. In Windows PowerShell use `npm.cmd` when passing arguments after `--`. Repeat `--input` for additional files or directories. Directories are scanned recursively for `.jsonl` match files; use directories containing self-play records, not other datasets. Symlinks are rejected. Byte-identical input copies are processed only once.

## Sampling and labels

| Option | Default | Meaning |
| --- | ---: | --- |
| `--stride` | 4 | Deterministically select approximately one in this many eligible positions |
| `--min-ply` | 4 | Minimum occupied-stone count |
| `--max-ply` | 224 | Maximum occupied-stone count |
| `--min-depth` | 0 | Minimum completed search depth for the associated move |
| `--seed` | 1 | Seed for position sampling and group assignment |
| `--validation` | 0.2 | Fraction of groups assigned to validation, between zero and one |

Hash sampling avoids an even stride selecting only one side to move. A given symmetric position is selected consistently wherever it occurs. The actual position fraction and split sizes vary with the data. Positions before the setup opening and terminal boards are excluded. Every sample describes the board **before** the recorded engine move: its search score and outcome are both from the perspective of the side moving in that board.

Samples canonicalise rotations and reflections, preserving stone colours, board edges, and side to move. They never translate boards or swap colours. Each unique canonical position produces one row; repeated occurrences contribute label counts rather than duplicate rows.

`outcome` is the mean of observed wins (+1), draws (0), and losses (−1). Conflicting outcomes are retained in `outcomeCounts`. The corresponding empirical win/draw probability target is `(outcome + 1) / 2`. This describes the recorded self-play policies, not the theoretical value of the board.

`searchLabels` retains distinct raw scores, completed depths, engine digests, and eight evaluation weights, with observation counts. Labels from different teachers, depths, or scores are not averaged together. Root shortcuts have no search score and contribute only an outcome observation. Version 1 assumes the current engine's 1,000,000 win score; scores within 225 of its absolute value are marked `mate`, while other searched scores are marked `evaluation`. A trainer must choose how to handle these different scales and select a consistent teacher/depth when appropriate.

## Leakage prevention

The exporter builds a graph of related games before sampling. Games sharing the same canonical opening are joined. Games reaching the same canonical board and side to move are also joined, including positions outside sampling bounds, positions filtered by depth, and terminal boards. Transitive connections form one group. Only post-opening positions enter this graph; the common empty-board prefix does not connect all games.

Each connected group is assigned wholly to training or validation using its stable identifier and the split seed. All sampled symmetric duplicates, paired games, and connected transpositions therefore stay in one split. Large connected groups may cause the actual validation fraction to differ from the requested fraction. The exporter warns if one split is empty.

Splits apply to all inputs in **one export**. Exporting training and validation separately cannot protect against overlap between them. Adding input games may join previously separate groups and change assignments; regenerate the complete dataset together and identify it by its manifest. Changing the split seed after repeatedly evaluating models on validation would weaken that validation as an independent test.

## Output format and reproduction

The output directory contains `train.jsonl`, `validation.jsonl`, and `manifest.json`. Each JSONL row has:

- `id`: SHA-256 identifier of the canonical position.
- `group`: identifier of the connected game group used for splitting.
- `black`, `white`: sorted zero-based square indices (`row * 15 + column`).
- `sideToMove`, `ply`: next player and number of occupied squares.
- `outcome`, `outcomeCounts`, `observations`: aggregated game-result labels.
- `searchLabels`: distinct teacher score labels with depth, engine identity, weights, kind, and observation count.

For NNUE inputs, these sparse indices can populate stone features and a side-to-move feature, or be transformed into own/opponent features. Architecture, accumulator layout, loss, and score calibration are later training choices.

The manifest records schema version, freestyle rules, label perspective, sampling options, exporter source digest, input paths and SHA-256 hashes, original run configurations, deduplication statistics, group counts, side counts, and output file hashes. There are no timestamps or elapsed times in generated rows. Input filenames are sorted; re-running the same export produces byte-identical files. An existing output with different inputs, options, or exporter code is rejected; use another output directory. The exporter validates complete records, legal terminal games, colour assignments, openings, and search-label alignment before writing output.

The initial dataset exported from the stronger-twos validation contains 2,600 games from 16 unique match files. With stride 4, seed 42, and validation fraction 0.2:

| Measure | Count |
| --- | ---: |
| Sampled observations | 26,297 |
| Unique positions | 15,283 |
| Duplicate observations merged | 11,014 |
| Training positions | 12,541 |
| Validation positions | 2,742 |
| Black / White to move | 7,671 / 7,612 |
| Connected groups with samples | 514 |

These mostly shallow-search games are suitable for testing a training pipeline. Demonstrating a stronger NNUE evaluator will require training, fresh match evaluation, and likely more diverse games or stronger search labels. The exporter processes its inputs and position graph in memory; very large corpora will need a streaming or database-backed implementation.

The [first NNUE experiment](nnue.md) trains a small additive evaluator on this dataset and exports weights with a checked incremental reference implementation.

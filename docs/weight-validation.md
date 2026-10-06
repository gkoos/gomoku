# Stronger-twos validation

The first batch experiment selected stronger twos as a candidate for validation: `openTwo = 200` and `closedTwo = 20`, double their default values. All other evaluation weights remained unchanged. Its initial score was 54.2% across 300 games at depth 4 on seeds 1, 2, and 3. No production defaults were changed.

## Reproduction

Use the single-candidate plan to compare these weights against defaults, including a default-versus-default control:

```bash
node scripts/selfplay/batch.js --config=experiments/stronger-twos-validation.json --games=200 --depth=4 --seeds=11,12,13,14,15 --output=.selfplay/stronger-twos-validation-depth4
node scripts/selfplay/batch.js --config=experiments/stronger-twos-validation.json --games=100 --depth=6 --seeds=21,22,23 --output=.selfplay/stronger-twos-validation-depth6
```

Rebuild with `npm run wasm:build` if the Node bindings are missing. Existing outputs resume only when the engine and match configuration are unchanged. Use a new output directory after changing the engine.

These runs used commit `3fa45e7`, Rust source digest `d6d2583d41f176b4f6d782f2ec19465bcde2a73bc634c65c70b1c9d51a6030f1`, and combined Node module/Wasm digest `445507acfb4a5e0d22c7e43c1d8451fcea6af65ce2a57908001134ea26ac3326`. A and B used identical builds. Search depth alone differed between stages; tactical extension remained four plies and cache capacity 32,768 entries. Games ran sequentially without deadlines.

Score is `(candidate wins + draws / 2) / games`. Each opening is played twice, swapping engine colours. Counts below refer to candidate games; an equal number of control games was also played. Detailed moves and search statistics are in the ignored `.selfplay` output directories.

## Depth 4

| Seed | Games | Wins | Draws | Losses | Score |
| --- | ---: | ---: | ---: | ---: | ---: |
| 11 | 200 | 109 | 2 | 89 | 55.00% |
| 12 | 200 | 102 | 4 | 94 | 52.00% |
| 13 | 200 | 101 | 5 | 94 | 51.75% |
| 14 | 200 | 104 | 1 | 95 | 52.25% |
| 15 | 200 | 102 | 0 | 98 | 51.00% |
| Total | 1000 | 518 | 12 | 470 | 52.40% |

The 1,000-game control scored exactly 50%: 495 wins, 10 draws, and 495 losses. Each control opening pair produced identical move sequences after swapping engine identities.

The candidate's approximate paired 95% interval is 49.6–55.2%, which includes 50%. This uses the sample standard deviation of the 500 pair scores, with interval `mean ± 1.96 * standardDeviation / sqrt(pairCount)`. It is a normal approximation, not a guarantee or a correction for repeated positions.

Fresh seeds do not guarantee entirely new positions. Canonicalising the four-stone opening boards under rotations and reflections found 461 distinct boards among the 500 pairs. Twenty-eight pairs overlap the original experiment. Excluding those leaves 944 games: 488 wins, 11 draws, and 445 losses, for 52.28%. Symmetry is used only for this overlap audit; search behaviour is unchanged.

## Depth 6

| Seed | Games | Wins | Draws | Losses | Score |
| --- | ---: | ---: | ---: | ---: | ---: |
| 21 | 100 | 52 | 0 | 48 | 52.00% |
| 22 | 100 | 52 | 1 | 47 | 52.50% |
| 23 | 100 | 50 | 1 | 49 | 50.50% |
| Total | 300 | 154 | 2 | 144 | 51.67% |

The 300-game control scored exactly 50%: 149 wins, two draws, and 149 losses. Control pairs again produced identical move sequences. All candidate records replayed to legal terminal boards with the same opening assignments as the controls.

The candidate's approximate paired 95% interval is 46.7–56.6%, using the same method over 150 opening pairs. There were 146 distinct canonical opening boards. Thirty-three pairs overlap either the original experiment or the depth-4 validation. Excluding them leaves 234 games: 114 wins, two draws, and 118 losses, for 49.15%.

The batch outputs were reopened successfully after completion, validating resume and replay without recalculating games. Across both depths, 1,300 candidate games and 1,300 control games were completed. The analysis summary is saved locally at `.selfplay/stronger-twos-validation-summary.json`.

## Conclusion

Keep the existing default weights. The candidate scored slightly above 50% at both depths and in each seed group, but neither paired interval excludes 50%. The depth-6 result on openings absent from earlier stages is also below 50%. These observations do not establish a strength improvement, or a regression.

The original 54.2% result did not reproduce at that magnitude. Stronger twos remains an experimental preset. A later tuning campaign should exclude previously used canonical openings before playing validation games and account for repeated openings when estimating uncertainty. More games or a broader range of opponents could help establish a small gain; this experiment does not justify changing production evaluation.

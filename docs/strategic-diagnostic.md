# Strategic loss diagnostic

Replays our own losses from an external match and uses Rapfi as an **external
oracle**: at each of our decisions it asks Rapfi what it would play there, and how
it evaluates our move versus its own. The difference (the "drop") locates where
the game was strategically lost.

The tactical losses were already characterised in
[external loss analysis](external-loss-analysis.md): the engine is tactically
clean. This page probes the *quiet* moves, which that analysis could not judge.

## Command

```powershell
node scripts/external-match/strategic.js --input=.selfplay/external-rapfi-depth6/report.json --output=.selfplay/strategic-d6
# Limit the work while tuning:
node scripts/external-match/strategic.js --games=15 --rafi-time=500 --output=.selfplay/strategic-d6-500ms
```

`--games=0` analyses every loss; `--rafi-time` is Rapfi's per-query thinking time
in milliseconds; `--threshold` sets the drop that counts as "bad". Output is
`strategic.json` with the per-decision table and a summary. Values come from
Rapfi's side-to-move `Eval` line, converted to our perspective; mate scores are
scaled to about ±1e6 so a missed win still dominates a quiet swing.

## Method and limits

For each of our turns the script queries Rapfi three times: the position before
the move (Rapfi's own choice plus an evaluation), the position after our move, and
the position after Rapfi's move. The drop is `our value − Rapfi's value`, so a
positive drop means Rapfi's move was better. Each decision is classified as
`missed-forced-win` (we had a proven win before and our move gives it up),
`walked-into-loss` (our move allows a proven loss that Rapfi's does not),
`already-decided` (some side is already winning by force), or `positional`.

Limits: the oracle is only as strong as its time budget. Re-running the same 15
games at 100 ms and 500 ms keeps the same drop sign for 81.4% of decisions and the
same magnitude within ±100 for 76.5%, but a deeper oracle reclassifies some drops
from positional to forced, so the split below is a lower bound on the tactical
share.

## Recorded result (Rapfi depth 6, seed 43)

95 losses, 1401 decisions, 1306 scored.

| Measure | Value |
| --- | ---: |
| We play Rapfi's own move | 552 / 1401 (39.4%) |
| Drop median / p90 | 0 / 564 |
| First bad decision is positional | 57 of 95 games |
| First bad decision walks into a forced loss | 19 |
| First bad decision misses a forced win | 16 |
| Ply of the first bad decision | 4-15, clustered at 4-7 (median 7) |

The first significant mistake comes **immediately after the four-ply opening**
(ply 4-7), not late. Most losses are positional, but a real minority (35 of 95
games) involve a clean forced-sequence error.

## Eval versus search probe

The decisive follow-up re-evaluates the two child positions with **our** engine
(`SearchEngine` at depth 0, pure static, and depth 1) instead of Rapfi's. Over the
438 non-mate divergences:

| Measure | Value |
| --- | ---: |
| Our static eval prefers Rapfi's move | 145 (33.1%) |
| Our 1-ply search prefers Rapfi's move | 140 (32.0%) |
| Both prefer our (worse) move | 256 (58.4%) |

So in **58% of the divergences our own evaluation already believes the wrong move
is better** - the evaluation is blind, not just the search. In 33% the evaluation
knows and the search still did not deliver it (candidate retention), and about 8%
are mixed. That split is the main result of this diagnostic: the strategic gap is
led by the evaluation, which is a plain linear sum of pattern contributions with
no initiative or tempo term.

The `--initiative` evaluator flag (see [native engine](native-engine.md)) is one
attempt to close that gap; it is a tested negative, scoring the baseline 12% at
every weight tried.

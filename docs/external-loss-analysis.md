# Rapfi baseline loss analysis

This analysis uses the 100-game depth-six baseline described in
[external matches](external-matches.md). It examines all 95 losses and 1,401
Gomoku decisions in those losses. Coordinates below are zero-based **(row, col)**;
the protocol uses the reverse order, x=col and y=row.

## Reproduce

```powershell
# Full scan plus the first heuristic defense and last pre-fork decision per loss.
npm.cmd run external:analyze -- --probe-limit=200 --output=.selfplay/external-rapfi-depth6/analysis-expanded
# Compare played and alternative moves by searching their child positions.
npm.cmd run external:compare
```

`external:analyze` defaults to 12 probes and depths 6,8. Override `--input=PATH`,
`--output=DIR`, `--probe-limit=N`, and `--depths=6,8`. Zero probes performs only
the board scan. The analyzer saves each probe separately and resumes with
matching input, Wasm, and analyzer checksums. Changed inputs/settings require a
new analysis directory. `external:compare` accepts `--input=PATH` and
`--output=PATH`; it reruns child comparisons each time.

Analysis uses the current browser Wasm engine, whose checksum is recorded. Root
shortcut moves matched every observed shortcut in the native baseline. A later
engine build can analyze these positions again in another directory, but its
findings should not be described as the original engine's behavior.

Saved artifacts are local, ignored files:

- `analysis-expanded/scan.json`: all losing-game decisions, move prefixes, root
  classification, immediate winning squares, and summary counts.
- `analysis-expanded/report.json`: 184 distinct depth-six/eight search probes.
- `comparison.json`: played-move versus alternative child scores and independent
  continuous-four witness checks.

The scan uses a literal-square win checker independent of engine threat caches.
The continuous-four verifier checks each mandatory reply and rejects a purported
proof as soon as the attack becomes quiet. A quiet move can still be winning;
proving it requires considering multiple defensive replies.

## Immediate tactics worked; earlier decisions need attention

| Decision classification in losses | Count |
| --- | ---: |
| Ordinary search | 759 |
| Heuristic open-four defense | 310 |
| Single mandatory block | 237 |
| Multiple immediate winning threats | 95 |

There were no missed immediate wins or single mandatory blocks. Every loss
eventually reached two opponent winning squares without an immediate win for
Gomoku. This describes the final losing position; it does not establish that the
earlier game was unavoidable or that the final block was a bug.

The opening suite contains 49 distinct positions under board rotations and
reflections across 50 opening pairs. These are compact generated openings,
rather than a curated suite of balanced competitive positions.

## Confirmed weakness: defensive shortcuts ignore forcing tempo

`root::prepare` returns an open-four defense before iterative search. Its
defender selector recognizes immediate wins and double-winning-square attacks,
but a single forcing four can also be valuable: it forces a reply and buys a
turn to finish defending. Merely minimizing the number of opponent open-four
creation squares does not account for this.

In pair 46, game 0, Black to move after 16 stones:

- Black: (8,6), (8,7), (9,6), (10,5), (8,8), (6,7), (8,4), (6,6).
- White: (9,5), (9,8), (10,6), (7,8), (8,9), (7,7), (8,5), (7,10).

The engine played **(10,7)**, square 157. White can play **(7,9)**, square 114,
creating winning squares **(7,6)** and **(7,11)**. This loss is independently
verified: Black cannot cover both endpoints, and has no immediate win.

Depth-six and depth-eight searches both prefer **(7,6)**, square 111. This creates
Black's single winning square **(5,6)**, square 81. White must block there;
Black can then defend (10,7). That prevents the specific immediate fork above.
It does not prove that Black wins the game, but it avoids the shortcut's forced
loss. The played move scored -999996; the searched alternative scored -2805 at
depth six and -2890 at depth eight.

Of 91 losses containing a heuristic defense, the first such defense differed
from searched choices in 26 cases at depth six and 30 at depth eight. Different
choices alone do not establish improvement. Child-position checks and the
independent witness above supply stronger evidence for the specific example.

**Implemented follow-up:** searched difficulties now treat the heuristic defense
as a first-iteration ordering hint. They also verify immediate open-four replies
while comparing root candidates, preventing an obviously losing quiet move from
appearing safe because its opponent reply was pruned. Easy retains its heuristic.
The position above is covered by Rust and JavaScript/Wasm regression tests.

The same 100 games were rerun after this change at depth six. The result was
**6 wins, 0 draws, 94 losses**, versus 5/0/95 before. All wins were Black wins;
only pair 38, game 0 changed its outcome from loss to win. This small difference
does not establish a strength improvement. Mean observed move time was 19.9 ms
versus 19.6 ms; median was 14 ms versus 12 ms, and the 95th percentile was 57 ms
versus 60 ms. Timing covers different played positions and is not a per-position
CPU benchmark. The raw rematch and checksum-linked comparison are saved under
`.selfplay/external-rapfi-searched-defense-depth6/`.

Reproduce the rematch with:

```powershell
npm.cmd run native:build
npm.cmd run external:match -- --output=.selfplay/external-rapfi-searched-defense-depth6
```

The original recommendation was to keep immediate wins and mandatory
blocks fast, but let searched difficulties compare forcing counterattacks and
defenses instead of returning this heuristic defense unconditionally. Preserve
the Easy heuristic and add the position above as an engine regression fixture.

## Selective mate scores need cautious interpretation

The search restricts candidate membership as well as ordering: the width is
`max(8, 20 - 2 * remainingDepth)`, retaining immediate wins, immediate blocks,
and an eligible previous principal move. Other forcing moves and defenses can
fall outside the prefix. Iterative search stops on a mate-sized score.

In pair 13, game 1, after 13 stones, the shortcut plays square 86. Search instead
chooses 96; a requested depth-eight search stops at depth seven with score
999991. Searching the position after 96 at one additional nominal ply returns
-708 rather than a mate score. The principal line also contains a quiet first
attack, so a single line cannot independently certify all opponent replies.

This is evidence that mate-sized scores from the selective search are not a
complete tactical certificate. It does not by itself prove that the position is
winning or losing. Protecting tactical moves and verifying mates deserves
attention before using these scores as definitive teacher labels or assuming
that every deeper reported win is reliable.

## Tactical search is a better next experiment than weight tuning

The horizon follows existing immediate wins and mandatory blocks but stops at a
position with no immediate winning square. It does not initiate another forcing
four from a quiet horizon. Longer forcing attacks can therefore be evaluated
statically before the final double threat appears.

After addressing the root shortcut, add a bounded continuous-four tactical
solver or forcing-attack extension, with explicit counter-win checks. Retain
forcing attacks and their defenses through candidate selection. The baseline
provides concrete fixtures and a repeatable match to measure the change; the
rematch difference remains too small to support a strength claim.

None of these findings establishes that tuning static weights cannot help.
They identify tactical limitations worth testing before another tuning run.

# Gomoku AI algorithm

## Rules and terminology

The board is 15 × 15. Black moves first. Five or more consecutive stones wins horizontally, vertically, or diagonally. This is unrestricted Gomoku; Renju restrictions on overlines, double threes, and double fours are not enforced.

A ply is one player's move. A winning square is an empty square on which a player wins immediately. An open four has two empty winning endpoints; a closed or broken four can have only one. Candidates are legal moves selected for consideration rather than every empty square.

## Move-selection pipeline

[engine.js](../src/ai/engine.js) applies these steps for every difficulty:

1. Reject terminal positions, including overlapping colors and simultaneous winners.
2. Play the center on an empty board.
3. Take an immediate win.
4. Block an opponent's immediate winning square. Multiple winning squares can make the loss unavoidable.
5. Play a move that creates an open four.
6. If the opponent can create an open four, Easy compares heuristic defenses and winning counterattacks. Medium, Hard, and Expert use that heuristic choice to order the first search iteration, then compare defenses and forcing counterattacks through iterative search.
7. Otherwise score or search candidates according to difficulty.
8. If selection fails, return a legal fallback, or no move on a terminal board.

Creating a blockable four is evaluated alongside alternatives rather than automatically preferred.

## Difficulty levels

| Level | General move selection |
| --- | --- |
| Easy | Heuristic candidate scoring |
| Medium | Iterative deepening through 6 plies |
| Hard | Iterative deepening through 8 plies |
| Expert | Iterative deepening through 10 plies |

All levels share the tactical checks. Search can stop earlier after proving a terminal win or loss. Forced horizon replies can extend beyond the nominal depth.

There are no deadlines or node budgets. Expert uses the same candidate policy as Hard. Extra depths can cost substantially more when many replies are plausible. Move now accepts the latest completed iteration.

## Candidate generation

[moves.js](../src/ai/moves.js) includes:

- Empty squares within Chebyshev distance one of any stone: all eight adjacent directions.
- Empty squares within distance two of a source stone whose clipped radius-two neighborhood contains at least three occupied squares, including the source itself.
- Nine predefined center-area candidates when the board is empty. The normal engine entry point instead plays the center immediately.

Row-mask shifts and unions build these frontiers together. Numeric counts still determine density: a membership bit cannot express how many stones are nearby.

For candidate density D and center bonus C, adjacent priority is 100 + 20D + C. Extended-only priority is 30 + 5S + C, where S is the greatest density among qualifying source stones. C is 14 minus Manhattan distance from (7, 7).

Candidates sort by immediate win, mandatory block, then priority. Ties preserve the original source/offset enumeration order. Generation normally retains 30 moves before ten stones are present, and 50 afterward. All immediate wins and blocks survive the cap.

Search applies a second cap for remaining depth d: max(8, floor(20 - 2d)). Immediate wins replace quiet alternatives. A single opposing winning square restricts the branch to its block. Tactical candidates survive this cap too. A matching previous principal-variation move is promoted, replacing a quiet candidate if necessary.

This is selective search, not exhaustive minimax over all legal moves.

## Evaluation

[patterns.js](../src/ai/patterns.js) classifies a nine-square window around each occupied stone in four directions. Friendly and blocker masks describe usable five-square windows, broken formations, and winning extensions. Opponent stones and board edges block windows.

The search evaluator uses these per-direction values:

| Formation | Score |
| --- | --- |
| Five or more | 100,000 |
| Four with at least two winning squares | 20,000 |
| Other four | 10,000 |
| Open three / other three | 1,000 / 100 |
| Open two / other two | 100 / 10 |
| Single stone | Up to 2, based on usable windows |

[evaluation.js](../src/ai/evaluation.js) sums contributions at each occupied stone and subtracts the opponent's total. A formation can contribute at multiple anchors; the total is a heuristic rather than a count of independent threats. Static scores are clamped to ±500,000 so they cannot outrank terminal results.

Easy uses a separate proposed-move evaluator: stronger three/two/single-stone weights, defensive credit for blocking opponent formations, and center/local-density bonuses.

## Iterative deepening and alpha-beta

[search.js](../src/ai/search.js) completes depths 1 through the difficulty cap. The computer maximizes scores; the opponent minimizes them. Alpha-beta skips branches that cannot improve the current bound. Each completed iteration supplies a best move and principal variation for ordering the next depth. PV ordering applies only while the current path matches that line.

Principal variation search (PVS) uses that ordering: the first candidate receives
the full window, then later candidates receive a one-point scout window at
nodes with more than one remaining ply. Maximizing nodes probe `[alpha,
alpha + 1]`; minimizing nodes probe `[beta - 1, beta]`. A score improving the
current bound inside the full window triggers a full-window re-search. A bound
already sufficient for a cutoff needs no re-search. Depth-one horizons are
window-independent, so their moves retain ordinary alpha-beta calls. PVS does
not change candidate selection, evaluation, or depth limits.

A win scores 1,000,000 minus plies from the root. A loss scores -1,000,000 plus that distance. This prefers faster wins and delays unavoidable losses. Immediate winning branches return directly without constructing a child position.

When comparing root moves, search also verifies the opponent's immediate open-four creation. If neither player currently has a winning square, that reply guarantees a win three plies later and cannot be hidden by quiet candidate pruning. The check applies at the first reply when search depth remains, or when at least three tactical extension plies are allowed. It preserves mate-distance scoring and supplies a legal fork/block/win continuation.

Only completed iterations are published. A partially searched root is biased by the order of examined moves and is not used by Move now.

## Tactical horizon

[tactical-search.js](../src/ai/tactical-search.js) handles depth-zero positions:

- Take the side-to-move's immediate win first.
- With no own immediate win, two or more opposing winning squares imply an unavoidable loss.
- One opposing winning square forces a block, followed by another tactical check.
- Quiet positions with a possible four-creating move probe a bounded continuous-four (VCF) solver for the side to move. A verified forcing sequence returns a win score and continuation; otherwise they return static evaluation.

The default budget follows at most four additional blocking moves. At the limit, immediate wins and unavoidable multiple-threat losses are still recognized; an unresolved single block falls back to static evaluation. This is a bounded forced-reply extension, not a general search of all forcing threats.

At quiet positions reached before that blocking budget expires, VCF can follow up to seven additional plies with at most 32 solver nodes. The solver enumerates four-creating attacks without normal candidate pruning, forces each unique block, and rejects attacks when the defender can win first. It runs only for the actual side to move: an opponent's hypothetical attack on a different turn does not establish a loss. Setting the tactical extension to zero also disables horizon VCF.

Scores include the current root distance plus the proven continuation's length. The solver returns the first verified win, so this length is a proven winning distance rather than a guarantee of the shortest possible mate. Unknown and exhausted probes fall back to evaluation; they never establish a loss. Root VCF retains its separate 15-ply/2,048-node limits.

## Caching and limitations

A bounded transposition table reuses compatible exact results and alpha-beta bounds. Hashes and mate distances are maintained incrementally; see the [implementation guide](implementation.md#hashing-and-transposition-table).

Candidate pruning, heuristic evaluation, root shortcuts, and bounded extensions limit playing strength. More depth does not guarantee a better move. Double-open-three detection, killer/history ordering, and aspiration windows are not implemented. Expert currently has no adaptive restriction or work budget.


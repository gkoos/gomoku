"""Measure the portable Python reference, not browser/Wasm search performance."""
import argparse
import json
import math
import random
import statistics
import time
from pathlib import Path

from inference import PortableNNUE, Position


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--positions", type=Path, required=True)
    parser.add_argument("--repeats", type=int, default=20)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.repeats < 1:
        parser.error("Repeats must be positive")
    network = PortableNNUE(args.model)
    rows = [json.loads(line) for line in args.positions.read_text(encoding="utf8").splitlines()]
    if not rows:
        parser.error("No positions")
    selected = random.Random(42).sample(rows, min(64, len(rows)))
    cases = []
    for row in selected:
        state = Position(network, row["black"], row["white"], row["sideToMove"])
        move = next(p for p in range(225) if p not in state.stones)
        state.make_move(move)
        features = state.features()
        expected = network.predict(features)
        if not math.isclose(state.predict(), expected, abs_tol=1e-10):
            raise RuntimeError("Inference mismatch")
        state.undo_move()
        cases.append((state, move, features))
    def full():
        for _, _, features in cases:
            network.predict(features)
    def incremental():
        for state, move, _ in cases:
            state.make_move(move)
            state.predict()
            state.undo_move()
    full()
    incremental()
    times = {"full": [], "incremental": []}
    for repeat in range(7):
        order = [("full", full), ("incremental", incremental)]
        if repeat % 2:
            order.reverse()
        for name, run in order:
            start = time.perf_counter()
            for _ in range(args.repeats):
                run()
            times[name].append((time.perf_counter() - start) * 1e6 / (args.repeats * len(cases)))
    report = {"implementation": "Python standard-library float reference", "positions": len(cases),
              "fullMicroseconds": statistics.median(times["full"]),
              "makePredictUndoMicroseconds": statistics.median(times["incremental"])}
    report["referenceSpeedup"] = report["fullMicroseconds"] / report["makePredictUndoMicroseconds"]
    if args.output:
        args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()

"""Write test/fixtures/policy-forward.json with exact dyadic cases.

The weights and feature values are multiples of 1/8, so the forward pass is exact
in float32 and every implementation reproduces the same scores.
"""
import json
from pathlib import Path

HIDDEN, FEATURES = 3, 25
input_weights = [((i * 7 + j) % 5 - 2) * 0.25 for j in range(HIDDEN) for i in range(FEATURES)]
bias = [(j - 1) * 0.5 for j in range(HIDDEN)]
output = [(j - 2) * 0.25 for j in range(HIDDEN)]
output_bias = 0.125


def score(features):
    total = output_bias
    for j in range(HIDDEN):
        accumulator = bias[j]
        for i in range(FEATURES):
            accumulator += input_weights[j * FEATURES + i] * features[i]
        total += output[j] * (accumulator if accumulator > 0 else 0.0)
    return total


cases = [
    {"features": [((i + k) % 4) * 0.125 for i in range(FEATURES)]}
    for k in range(4)
]
for case in cases:
    case["score"] = score(case["features"])

fixture = {"features": FEATURES, "hidden": HIDDEN, "input": input_weights, "bias": bias,
           "output": output, "outputBias": output_bias, "cases": cases}
Path("test/fixtures").mkdir(parents=True, exist_ok=True)
Path("test/fixtures/policy-forward.json").write_text(json.dumps(fixture, indent=2) + "\n", encoding="utf8")
print(f"wrote {len(cases)} cross-language cases")

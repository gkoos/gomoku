"""Small additive network: absolute stone features plus side-to-move features."""
import torch
from torch import nn

FEATURES = 452


def feature_indices(row):
    black, white = row["black"], row["white"]
    if any(type(p) is not int or not 0 <= p < 225 for p in black + white):
        raise ValueError("Invalid stone index")
    if len(set(black + white)) != len(black + white):
        raise ValueError("Overlapping or repeated stones")
    if row["sideToMove"] not in ("black", "white"):
        raise ValueError("Invalid side to move")
    return black + [225 + p for p in white] + [450 if row["sideToMove"] == "black" else 451]


def symmetry_permutations():
    permutations = []
    for transform in range(8):
        permutation = list(range(FEATURES))
        for p in range(225):
            r, c = divmod(p, 15)
            if transform >= 4:
                c = 14 - c
            for _ in range(transform % 4):
                r, c = c, 14 - r
            dest = r * 15 + c
            # Indexing dense inputs requires the inverse permutation.
            permutation[dest] = p
            permutation[225 + dest] = 225 + p
        permutations.append(permutation)
    return torch.tensor(permutations, dtype=torch.long)


class NNUE(nn.Module):
    def __init__(self, hidden=64):
        super().__init__()
        self.features = nn.Linear(FEATURES, hidden)
        self.output = nn.Linear(hidden, 1)

    def forward(self, inputs):
        accumulator = self.features(inputs)
        return self.output(accumulator.clamp(0, 1)).squeeze(-1)

    def predict(self, inputs):
        return torch.sigmoid(self(inputs))

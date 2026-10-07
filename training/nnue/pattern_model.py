"""Small pattern-histogram value network: side-to-move win probability."""
import torch
from torch import nn

PATTERN_FEATURES = 65


class PatternEval(nn.Module):
    def __init__(self, hidden=64, features=PATTERN_FEATURES):
        super().__init__()
        self.features = features
        self.hidden = hidden
        self.input = nn.Linear(features, hidden)
        self.output = nn.Linear(hidden, 1)

    def forward(self, inputs):
        return self.output(torch.relu(self.input(inputs))).squeeze(-1)

    def predict(self, inputs):
        return torch.sigmoid(self(inputs))

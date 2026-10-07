"""Small per-candidate re-ranker: one score for each (position, move) pair."""
import torch
from torch import nn

POLICY_FEATURES = 25
FEATURE_LAYOUT = (
    "priority,density,center,tactical,ply | per direction (down,right,diag-down,diag-up): "
    "ownRun,openEnds,opponentAdjacent,ownWithin4,opponentWithin4"
)


class Policy(nn.Module):
    def __init__(self, hidden=64, features=POLICY_FEATURES):
        super().__init__()
        self.features = features
        self.hidden = hidden
        self.input = nn.Linear(features, hidden)
        self.output = nn.Linear(hidden, 1)

    def forward(self, inputs):
        # inputs: (positions, candidates, features) -> scores (positions, candidates)
        return self.output(torch.relu(self.input(inputs))).squeeze(-1)

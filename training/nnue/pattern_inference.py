"""Portable GOMPAT1 export and inference for the pattern value network."""
import math
import struct
from pathlib import Path

import torch

PATTERN_MAGIC = b"GOMPAT1\x00"
PATTERN_FEATURES = 65


def export_pattern_model(model, filename):
    features, hidden = model.features, model.hidden
    state = model.state_dict()
    # Hidden-major: unit h, feature i at h * features + i.
    input_weights = state["input.weight"].detach().cpu().reshape(-1)
    bias = state["input.bias"].detach().cpu().reshape(-1)
    output = state["output.weight"].detach().cpu().reshape(-1)
    output_bias = state["output.bias"].detach().cpu().reshape(1)
    values = torch.cat([input_weights, bias, output, output_bias]).to(torch.float32).numpy().astype("<f4")
    if values.size != (features + 2) * hidden + 1:
        raise ValueError("Unexpected pattern coefficient count")
    header = PATTERN_MAGIC + struct.pack("<IIII", 1, features, hidden, 1)
    Path(filename).write_bytes(header + values.tobytes())


class PortablePattern:
    def __init__(self, filename):
        data = Path(filename).read_bytes()
        if len(data) < 24 or data[:8] != PATTERN_MAGIC:
            raise ValueError("Invalid pattern header")
        version, features, hidden, outputs = struct.unpack_from("<IIII", data, 8)
        if version != 1 or outputs != 1 or features != PATTERN_FEATURES or not 1 <= hidden <= 512:
            raise ValueError("Invalid pattern dimensions")
        if len(data) != 24 + ((features + 2) * hidden + 1) * 4:
            raise ValueError("Invalid pattern length")
        values = struct.unpack_from(f"<{(features + 2) * hidden + 1}f", data, 24)
        if not all(math.isfinite(value) for value in values):
            raise ValueError("Non-finite pattern coefficient")
        self.features, self.hidden, self.values = features, hidden, values

    def logit(self, features):
        if len(features) != self.features:
            raise ValueError("Feature width mismatch")
        width, hidden, values = self.features, self.hidden, self.values
        bias_offset, output_offset = width * hidden, width * hidden + hidden
        total = values[output_offset + hidden]
        for h in range(hidden):
            accumulator = values[bias_offset + h]
            base = h * width
            for i in range(width):
                accumulator += values[base + i] * features[i]
            total += values[output_offset + h] * (accumulator if accumulator > 0 else 0.0)
        return total

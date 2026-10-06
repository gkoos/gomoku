"""Portable float32 file with a standard-library incremental reference evaluator."""
import math
import struct

MAGIC = b"GOMNNUE1"
HEADER = struct.Struct("<8sIIII")


def export_model(model, filename):
    hidden = model.features.out_features
    values = (model.features.weight.detach().t().contiguous().flatten().tolist()
              + model.features.bias.detach().tolist()
              + model.output.weight.detach().flatten().tolist()
              + model.output.bias.detach().tolist())
    with open(filename, "wb") as output:
        output.write(HEADER.pack(MAGIC, 1, 452, hidden, 1))
        output.write(struct.pack(f"<{len(values)}f", *values))


class PortableNNUE:
    def __init__(self, filename):
        with open(filename, "rb") as source:
            data = source.read()
        if len(data) < HEADER.size:
            raise ValueError("Truncated NNUE header")
        magic, version, features, hidden, outputs = HEADER.unpack_from(data)
        if magic != MAGIC or version != 1 or features != 452 or not 1 <= hidden <= 512 or outputs != 1:
            raise ValueError("Unsupported NNUE format")
        count = (features + 2) * hidden + 1
        if len(data) != HEADER.size + count * 4:
            raise ValueError("Wrong NNUE file length")
        values = struct.unpack_from(f"<{count}f", data, HEADER.size)
        if not all(math.isfinite(v) for v in values):
            raise ValueError("Nonfinite NNUE weight")
        self.hidden = hidden
        self.weights = [values[i * hidden:(i + 1) * hidden] for i in range(features)]
        self.bias = values[features * hidden:(features + 1) * hidden]
        self.output = values[(features + 1) * hidden:(features + 2) * hidden]
        self.output_bias = values[-1]

    def accumulator(self, features):
        result = list(self.bias)
        for feature in features:
            weights = self.weights[feature]
            for i in range(self.hidden):
                result[i] += weights[i]
        return result

    def predict_accumulator(self, accumulator):
        logit = self.output_bias + sum(w * max(0, min(1, a)) for w, a in zip(self.output, accumulator))
        return 1 / (1 + math.exp(-logit)) if logit >= 0 else math.exp(logit) / (1 + math.exp(logit))

    def predict(self, features):
        return self.predict_accumulator(self.accumulator(features))


class Position:
    def __init__(self, network, black, white, side):
        if side not in ("black", "white") or any(type(p) is not int or not 0 <= p < 225 for p in black + white) or len(set(black + white)) != len(black + white):
            raise ValueError("Invalid NNUE position")
        self.network = network
        self.stones = {p: 0 for p in black} | {p: 1 for p in white}
        self.side = side
        self.history = []
        self.accumulator = network.accumulator(self.features())

    def features(self):
        return [p + 225 * color for p, color in self.stones.items()] + [450 if self.side == "black" else 451]

    def make_move(self, position):
        if type(position) is not int or not 0 <= position < 225 or position in self.stones:
            raise ValueError("Illegal NNUE move")
        self.history.append((position, self.side, self.accumulator.copy()))
        color = 0 if self.side == "black" else 1
        old_side = 450 + color
        new_side = 451 - color
        weights = self.network.weights
        for i in range(self.network.hidden):
            self.accumulator[i] += weights[position + 225 * color][i] - weights[old_side][i] + weights[new_side][i]
        self.stones[position] = color
        self.side = "white" if self.side == "black" else "black"

    def undo_move(self):
        if not self.history:
            raise ValueError("No move to undo")
        position, self.side, self.accumulator = self.history.pop()
        del self.stones[position]

    def predict(self):
        return self.network.predict_accumulator(self.accumulator)

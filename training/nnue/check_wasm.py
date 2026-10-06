"""Compare actual Rust/Wasm logits with the portable Python reference."""
import argparse
import json
import pathlib
import subprocess
import tempfile
from inference import PortableNNUE
from model import feature_indices

parser = argparse.ArgumentParser()
parser.add_argument('--model', required=True)
parser.add_argument('--positions', required=True)
args = parser.parse_args()
network = PortableNNUE(pathlib.Path(args.model))
rows = [json.loads(line) for line in pathlib.Path(args.positions).read_text().splitlines()][:512]
fixtures = []
for row in rows:
    for side in ['black', 'white']:
        copy = dict(row, sideToMove=side)
        # Dataset rows use `sideToMove`; feature_indices validates the schema.
        features = feature_indices(copy)
        probability = network.predict(features)
        fixtures.append(dict(black=row['black'], white=row['white'], turn=side == 'black', probability=probability))
with tempfile.TemporaryDirectory() as folder:
    source = pathlib.Path(folder) / 'positions.json'
    source.write_text(json.dumps(fixtures))
    subprocess.run(['node', 'scripts/check-nnue-wasm.js', args.model, str(source)], check=True)

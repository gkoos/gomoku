import hashlib
import json
import random
import tempfile
import unittest
from pathlib import Path

import torch

from model import NNUE, feature_indices, symmetry_permutations
from inference import PortableNNUE, Position, export_model
from train import load_dataset, search_probability


class NNUETest(unittest.TestCase):
    def test_stronger_search_targets_preserve_turn_sign_mates_and_teacher_identity(self):
        teacher = {"config": {"depth": 6, "engineDigest": "a" * 64}}
        label = {"score": 10000, "depth": 6, "requestedDepth": 6, "engineDigest": "a" * 64,
                 "weights": [100000, 20000, 10000, 1000, 100, 100, 10, 1], "kind": "evaluation"}
        self.assertAlmostEqual(search_probability({"teacherSearch": label}, teacher, 10000), 0.73105857863)
        self.assertAlmostEqual(search_probability({"teacherSearch": {**label, "score": -10000}}, teacher, 10000), 0.26894142137)
        for score, expected in [(999997, 1), (-999997, 0)]:
            self.assertEqual(search_probability({"teacherSearch": {**label, "score": score, "depth": 3, "kind": "mate"}}, teacher, 10000), expected)
        for bad in [{**label, "depth": 5}, {**label, "engineDigest": "b" * 64}, {**label, "score": float("nan")}, {**label, "kind": "mate"}]:
            with self.assertRaises(ValueError):
                search_probability({"teacherSearch": bad}, teacher, 10000)
        with self.assertRaises(ValueError):
            search_probability({}, teacher, 10000)

    def test_export_matches_torch_and_incremental_updates(self):
        torch.manual_seed(123)
        model = NNUE(16)
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / "model.nnue"
            export_model(model, filename)
            portable = PortableNNUE(filename)
            position = Position(portable, [], [], "black")
            original = position.accumulator.copy()
            positions = list(range(225))
            random.Random(42).shuffle(positions)
            for p in positions:
                position.make_move(p)
                self.assertAlmostEqual(position.predict(), portable.predict(position.features()), places=12)
                inputs = torch.zeros((1, 452))
                inputs[0, position.features()] = 1
                with torch.no_grad():
                    self.assertAlmostEqual(position.predict(), model.predict(inputs).item(), places=6)
            before = position.accumulator.copy()
            with self.assertRaises(ValueError):
                position.make_move(positions[-1])
            self.assertEqual(position.accumulator, before)
            for _ in positions:
                position.undo_move()
                self.assertAlmostEqual(position.predict(), portable.predict(position.features()), places=12)
            self.assertEqual(position.accumulator, original)
            with self.assertRaises(ValueError):
                position.undo_move()
            filename.write_bytes(filename.read_bytes()[:-1])
            with self.assertRaises(ValueError):
                PortableNNUE(filename)

    def test_features_and_symmetry_keep_colours_and_side(self):
        row = {"black": [31, 224], "white": [112], "sideToMove": "white"}
        self.assertEqual(feature_indices(row), [31, 224, 337, 451])
        inputs = torch.zeros(452)
        inputs[feature_indices(row)] = 1
        for permutation in symmetry_permutations():
            transformed = inputs[permutation]
            self.assertEqual(transformed[:225].sum().item(), 2)
            self.assertEqual(transformed[225:450].sum().item(), 1)
            self.assertEqual(transformed[451].item(), 1)
        with self.assertRaises(ValueError):
            feature_indices({"black": [31], "white": [31], "sideToMove": "black"})

    def test_dataset_integrity_and_group_overlap_are_checked(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            row = {"id": "train", "group": "one", "black": [112, 113], "white": [97, 98],
                   "ply": 4, "sideToMove": "black", "outcome": 0, "observations": 2,
                   "outcomeCounts": {"win": 1, "draw": 0, "loss": 1}}
            outputs = {}
            for split, group in [("train", "one"), ("validation", "two")]:
                filename = directory / f"{split}.jsonl"
                filename.write_text(json.dumps({**row, "id": split, "group": group}) + "\n", encoding="utf8")
                outputs[split] = {"file": filename.name, "positions": 1,
                                  "sha256": hashlib.sha256(filename.read_bytes()).hexdigest()}
            manifest = {"provenance": {"version": 1, "rules": "freestyle-15", "labelPerspective": "side-to-move"}, "outputs": outputs}
            manifest_file = directory / "manifest.json"
            manifest_file.write_text(json.dumps(manifest), encoding="utf8")
            splits, _ = load_dataset(directory)
            self.assertEqual(splits["train"][2].item(), 0.5)
            label = {"score": 10000, "depth": 6, "requestedDepth": 6, "engineDigest": "a" * 64,
                     "weights": [100000, 20000, 10000, 1000, 100, 100, 10, 1], "kind": "evaluation"}
            for split, group in [("train", "one"), ("validation", "two")]:
                filename = directory / f"{split}.jsonl"
                filename.write_text(json.dumps({**row, "id": split, "group": group, "teacherSearch": label}) + "\n", encoding="utf8")
                outputs[split]["sha256"] = hashlib.sha256(filename.read_bytes()).hexdigest()
            manifest["provenance"]["teacher"] = {"version": 1, "config": {"depth": 6, "engineDigest": "a" * 64}}
            manifest_file.write_text(json.dumps(manifest), encoding="utf8")
            search_splits, _ = load_dataset(directory, "search", 10000, 0.25)
            self.assertAlmostEqual(search_splits["train"][2].item(), .75 * .73105857863 + .25 * .5)
            with self.assertRaises(ValueError):
                load_dataset(directory, "search", 0)
            (directory / "validation.jsonl").write_text(json.dumps({**row, "id": "validation"}) + "\n", encoding="utf8")
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                load_dataset(directory)
            manifest["outputs"]["validation"]["sha256"] = hashlib.sha256((directory / "validation.jsonl").read_bytes()).hexdigest()
            manifest_file.write_text(json.dumps(manifest), encoding="utf8")
            with self.assertRaisesRegex(ValueError, "crossing splits"):
                load_dataset(directory)


if __name__ == "__main__":
    unittest.main()

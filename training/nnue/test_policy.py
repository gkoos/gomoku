import json
import tempfile
import unittest
from pathlib import Path

import torch

from policy_model import Policy, POLICY_FEATURES
from policy_inference import export_policy_model, PortablePolicy
from policy_train import batches, load_split, rank_of, scores_for, summarize


class PolicyTest(unittest.TestCase):
    def test_rank_and_summary(self):
        self.assertEqual(rank_of(torch.tensor([0.1, 0.9, 0.5]), 1), 0)
        self.assertEqual(rank_of(torch.tensor([0.1, 0.9, 0.5]), 0), 2)
        summary = summarize([0, 1, 2, 9])
        self.assertEqual(summary["positions"], 4)
        self.assertAlmostEqual(summary["top1"], 0.25)
        self.assertAlmostEqual(summary["top8"], 0.75)
        self.assertAlmostEqual(summary["mrr"], (1 + 0.5 + 1 / 3 + 0.1) / 4)
        self.assertAlmostEqual(summary["meanRank"], 3.0)
        self.assertEqual(summarize([]), {"positions": 0})

    def test_batches_pad_and_mask_variable_candidate_counts(self):
        examples = [(torch.zeros((2, POLICY_FEATURES)), 1, 0), (torch.ones((4, POLICY_FEATURES)), 3, 1)]
        (inputs, mask, targets), = list(batches(examples, 8, False))
        self.assertEqual(inputs.shape, (2, 4, POLICY_FEATURES))
        self.assertEqual(mask.tolist(), [[True, True, False, False], [True, True, True, True]])
        self.assertEqual(targets.tolist(), [1, 3])
        scores = scores_for(Policy(8), inputs, mask)
        self.assertEqual(scores.shape, (2, 4))
        self.assertTrue(torch.isneginf(scores[0, 2]) and torch.isneginf(scores[0, 3]))

    def test_load_split_validates_samples(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            row = {"id": "a", "n": 2, "target": 1, "tac": 0, "f": [0.0] * (2 * POLICY_FEATURES)}
            (directory / "train.jsonl").write_text(json.dumps(row) + "\n", encoding="utf8")
            (directory / "validation.jsonl").write_text(json.dumps(row) + "\n", encoding="utf8")
            examples = load_split(directory, "train")
            self.assertEqual(len(examples), 1)
            self.assertEqual(examples[0][0].shape, (2, POLICY_FEATURES))
            self.assertEqual(examples[0][1], 1)
            (directory / "train.jsonl").write_text(json.dumps({**row, "target": 5}) + "\n", encoding="utf8")
            with self.assertRaises(ValueError):
                load_split(directory, "train")

    def test_portable_model_reproduces_the_cross_language_fixture(self):
        fixture = json.loads(Path("test/fixtures/policy-forward.json").read_text(encoding="utf8"))
        model = Policy(fixture["hidden"])
        with torch.no_grad():
            model.input.weight.copy_(torch.tensor(fixture["input"], dtype=torch.float32)
                                     .reshape(fixture["hidden"], fixture["features"]))
            model.input.bias.copy_(torch.tensor(fixture["bias"], dtype=torch.float32))
            model.output.weight.copy_(torch.tensor(fixture["output"], dtype=torch.float32)
                                      .reshape(1, fixture["hidden"]))
            model.output.bias.copy_(torch.tensor([fixture["outputBias"]], dtype=torch.float32))
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / "model.policy"
            export_policy_model(model, filename)
            portable = PortablePolicy(filename)
            self.assertEqual((portable.features, portable.hidden), (fixture["features"], fixture["hidden"]))
            for case in fixture["cases"]:
                self.assertAlmostEqual(portable.score(case["features"]), case["score"], places=6)
            filename.write_bytes(filename.read_bytes()[:-1])
            with self.assertRaises(ValueError):
                PortablePolicy(filename)


if __name__ == "__main__":
    unittest.main()

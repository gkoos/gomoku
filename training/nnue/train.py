"""Reproducible CPU outcome or stronger-search training experiment."""
import argparse
import hashlib
import json
import math
import platform
import random
import re
from importlib.metadata import version
from pathlib import Path

import torch
from torch.nn import functional as F

from model import NNUE, FEATURES, feature_indices, symmetry_permutations
from inference import export_model, PortableNNUE, Position


def digest(filename):
    return hashlib.sha256(Path(filename).read_bytes()).hexdigest()


def search_probability(row, teacher, score_scale):
    label = row.get("teacherSearch")
    config = teacher.get("config", {}) if teacher else {}
    if not label or type(label.get("score")) is not int or abs(label["score"]) > 1_000_000:
        raise ValueError("Missing or invalid stronger-search label")
    score, depth = label["score"], label.get("depth")
    mate = abs(score) >= 1_000_000 - 225
    if type(depth) is not int or depth < 1 or depth > config.get("depth", 0) or (depth != config["depth"] and not mate):
        raise ValueError("Incomplete stronger-search depth")
    if label.get("requestedDepth") != config["depth"] or label.get("engineDigest") != config.get("engineDigest") or label.get("weights") != [100000, 20000, 10000, 1000, 100, 100, 10, 1] or label.get("kind") != ("mate" if mate else "evaluation"):
        raise ValueError("Inconsistent stronger-search teacher")
    if mate:
        return 1.0 if score > 0 else 0.0
    logit = max(-30, min(30, score / score_scale))
    return 1 / (1 + math.exp(-logit))


def load_dataset(directory, target="outcome", score_scale=10000, outcome_weight=0):
    if target not in ("outcome", "search") or not math.isfinite(score_scale) or not 1 <= score_scale <= 100000 or not math.isfinite(outcome_weight) or not 0 <= outcome_weight <= 1:
        raise ValueError("Invalid training target parameters")
    manifest_path = directory / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf8"))
    provenance = manifest["provenance"]
    if provenance["version"] != 1 or provenance["rules"] != "freestyle-15" or provenance["labelPerspective"] != "side-to-move":
        raise ValueError("Unsupported dataset")
    if target == "search":
        teacher = provenance.get("teacher", {})
        config = teacher.get("config", {})
        if teacher.get("version") != 1 or type(config.get("depth")) is not int or not 1 <= config["depth"] <= 10 or not isinstance(config.get("engineDigest"), str) or not re.fullmatch("[a-f0-9]{64}", config["engineDigest"]):
            raise ValueError("Missing or invalid stronger-search provenance")
    splits = {}
    all_ids, all_groups = set(), set()
    for split in ("train", "validation"):
        metadata = manifest["outputs"][split]
        if metadata["file"] != f"{split}.jsonl":
            raise ValueError("Unexpected dataset filename")
        filename = directory / metadata["file"]
        if digest(filename) != metadata["sha256"]:
            raise ValueError(f"Dataset hash mismatch: {split}")
        rows = [json.loads(line) for line in filename.read_text(encoding="utf8").splitlines()]
        if not rows or len(rows) != metadata["positions"]:
            raise ValueError("Empty split or inconsistent position count")
        ids, groups = {r["id"] for r in rows}, {r["group"] for r in rows}
        if len(ids) != len(rows) or ids & all_ids or groups & all_groups:
            raise ValueError("Duplicate positions or groups crossing splits")
        all_ids.update(ids)
        all_groups.update(groups)
        inputs = torch.zeros((len(rows), FEATURES))
        labels = []
        for i, row in enumerate(rows):
            indices = feature_indices(row)
            if len(indices) - 1 != row["ply"] or row["sideToMove"] != ("white" if row["ply"] % 2 else "black"):
                raise ValueError("Inconsistent board ply or side")
            counts = row["outcomeCounts"]
            if any(type(counts[k]) is not int or counts[k] < 0 for k in ("win", "draw", "loss")):
                raise ValueError("Invalid outcome counts")
            total = sum(counts.values())
            if total <= 0 or total != row["observations"] or not math.isfinite(row["outcome"]) or abs(row["outcome"] - (counts["win"] - counts["loss"]) / total) > 1e-12:
                raise ValueError("Inconsistent outcome label")
            inputs[i, indices] = 1
            outcome = (row["outcome"] + 1) / 2
            if target == "search":
                probability = search_probability(row, provenance.get("teacher"), score_scale)
                labels.append((1 - outcome_weight) * probability + outcome_weight * outcome)
            else:
                labels.append(outcome)
        splits[split] = (rows, inputs, torch.tensor(labels))
    return splits, digest(manifest_path)


def metrics(probabilities, targets):
    return {"crossEntropy": F.binary_cross_entropy(probabilities.clamp(1e-7, 1 - 1e-7), targets).item(),
            "brier": ((probabilities - targets) ** 2).mean().item()}


def evaluate(model, inputs, targets):
    model.eval()
    with torch.no_grad():
        probabilities = torch.cat([model.predict(chunk) for chunk in inputs.split(1024)])
    return metrics(probabilities, targets), probabilities


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--patience", type=int, default=8)
    parser.add_argument("--hidden", type=int, default=64)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--learning-rate", type=float, default=0.001)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--target", choices=("outcome", "search"), default="outcome")
    parser.add_argument("--score-scale", type=float, default=10000)
    parser.add_argument("--outcome-weight", type=float, default=0)
    args = parser.parse_args()
    if not 1 <= args.hidden <= 512 or min(args.epochs, args.patience, args.batch_size, args.threads) < 1 or not 0 < args.learning_rate < 1 or not 0 <= args.seed <= 0xffffffff:
        parser.error("Invalid training parameters")
    if args.output.exists():
        parser.error("Output already exists; choose a new directory")
    if not math.isfinite(args.score_scale) or not 1 <= args.score_scale <= 100000 or not math.isfinite(args.outcome_weight) or not 0 <= args.outcome_weight <= 1:
        parser.error("Invalid search-target scale or outcome weight")
    if args.target == "outcome" and args.outcome_weight:
        parser.error("--outcome-weight applies only to search targets")
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)
    torch.manual_seed(args.seed)
    random.seed(args.seed)
    splits, manifest_digest = load_dataset(args.dataset, args.target, args.score_scale, args.outcome_weight)
    _, train_x, train_y = splits["train"]
    validation_rows, validation_x, validation_y = splits["validation"]
    model = NNUE(args.hidden)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=0.0001)
    permutations = symmetry_permutations()
    baseline = metrics(torch.full_like(validation_y, train_y.mean().item()), validation_y)
    args.output.mkdir(parents=True)
    history, best, best_epoch, best_state = [], float("inf"), 0, None
    for epoch in range(1, args.epochs + 1):
        model.train()
        order = torch.randperm(len(train_x))
        loss_sum = 0.0
        for indices in order.split(args.batch_size):
            inputs, targets = train_x[indices], train_y[indices]
            rotations = torch.randint(0, 8, (len(indices),))
            inputs = inputs.gather(1, permutations[rotations])
            optimizer.zero_grad(set_to_none=True)
            loss = F.binary_cross_entropy_with_logits(model(inputs), targets)
            loss.backward()
            optimizer.step()
            loss_sum += loss.item() * len(indices)
        validation, _ = evaluate(model, validation_x, validation_y)
        history.append({"epoch": epoch, "trainCrossEntropy": loss_sum / len(train_x), "validation": validation})
        print(f"Epoch {epoch}: train CE {history[-1]['trainCrossEntropy']:.5f}; validation CE {validation['crossEntropy']:.5f}; Brier {validation['brier']:.5f}", flush=True)
        if validation["crossEntropy"] < best:
            best, best_epoch = validation["crossEntropy"], epoch
            best_state = {key: value.detach().clone() for key, value in model.state_dict().items()}
        if epoch - best_epoch >= args.patience:
            break
    model.load_state_dict(best_state)
    final_metrics, predictions = evaluate(model, validation_x, validation_y)
    outcome_targets = torch.tensor([(row["outcome"] + 1) / 2 for row in validation_rows])
    checkpoint = {"version": 1, "hidden": args.hidden, "features": FEATURES, "bestEpoch": best_epoch,
                  "datasetManifestSha256": manifest_digest, "target": args.target,
                  "scoreScale": args.score_scale if args.target == "search" else None, "state_dict": best_state}
    torch.save(checkpoint, args.output / "best.pt")
    export_model(model, args.output / "model.nnue")
    portable = PortableNNUE(args.output / "model.nnue")
    errors = [abs(portable.predict(feature_indices(row)) - prediction.item()) for row, prediction in zip(validation_rows, predictions)]
    if max(errors) > 1e-5:
        raise RuntimeError("Portable inference disagrees with PyTorch")
    position = Position(portable, [], [], "black")
    maximum_incremental_error = 0
    for p in random.sample(range(225), 225):
        position.make_move(p)
        maximum_incremental_error = max(maximum_incremental_error, abs(position.predict() - portable.predict(position.features())))
    for _ in range(225):
        position.undo_move()
        maximum_incremental_error = max(maximum_incremental_error, abs(position.predict() - portable.predict(position.features())))
    if maximum_incremental_error > 1e-10:
        raise RuntimeError("Incremental inference disagrees with full inference")
    with torch.no_grad():
        symmetric_predictions = [model.predict(validation_x[:, permutation]) for permutation in permutations]
        ensemble = torch.stack(symmetric_predictions).mean(dim=0)
    report = {"version": 1, "architecture": "452 -> clipped-ReLU hidden -> 1 sigmoid", "hidden": args.hidden,
              "target": "empirical side-to-move outcome probability" if args.target == "outcome" else "sigmoid(stronger-search score / scale), optionally blended with outcomes",
              "recommendedLogitScale": args.score_scale if args.target == "search" else None,
              "positionWeighting": "equal per unique position",
              "augmentation": "random rotation/reflection per training position per epoch",
              "parameters": {k: str(v) if isinstance(v, Path) else v for k, v in vars(args).items()},
              "environment": {"python": platform.python_version(), "torch": str(torch.__version__), "numpy": version("numpy"), "platform": platform.platform()},
              "trainerSha256": hashlib.sha256(b"".join(Path(__file__).with_name(name).read_bytes() for name in ("train.py", "model.py", "inference.py"))).hexdigest(),
              "datasetManifestSha256": manifest_digest, "trainPositions": len(train_x), "validationPositions": len(validation_x),
              "constantBaseline": baseline, "bestEpoch": best_epoch, "validation": final_metrics,
              "outcomeValidation": metrics(predictions, outcome_targets),
              "symmetryEnsembleValidation": metrics(ensemble, validation_y),
              "symmetryMeanStandardDeviation": torch.stack(symmetric_predictions).std(dim=0).mean().item(),
              "portableMaximumError": max(errors), "incrementalMaximumError": maximum_incremental_error,
              "modelSha256": digest(args.output / "model.nnue"), "modelBytes": (args.output / "model.nnue").stat().st_size,
              "history": history}
    (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
    print(json.dumps({k: v for k, v in report.items() if k != "history"}, indent=2))


if __name__ == "__main__":
    main()

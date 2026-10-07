"""Train and evaluate the pattern-histogram value network on labelled positions."""
import argparse
import hashlib
import json
import platform
import random
from importlib.metadata import version
from pathlib import Path

import torch
from torch.nn import functional as F

from pattern_model import PatternEval, PATTERN_FEATURES
from pattern_inference import export_pattern_model, PortablePattern


def digest(filename):
    return hashlib.sha256(Path(filename).read_bytes()).hexdigest()


def load_split(directory, split):
    rows = [json.loads(line) for line in (directory / f"{split}.jsonl").read_text(encoding="utf8").splitlines()]
    if not rows:
        raise ValueError(f"Empty {split} split")
    inputs = torch.zeros((len(rows), PATTERN_FEATURES))
    labels = torch.zeros(len(rows))
    for i, row in enumerate(rows):
        if len(row["f"]) != PATTERN_FEATURES or not 0 <= row["label"] <= 1:
            raise ValueError(f"Invalid sample {row.get('id')}")
        inputs[i] = torch.tensor(row["f"], dtype=torch.float32)
        labels[i] = row["label"]
    if not torch.isfinite(inputs).all():
        raise ValueError("Non-finite feature")
    return rows, inputs, labels


def metrics(probabilities, targets):
    return {
        "crossEntropy": F.binary_cross_entropy(probabilities.clamp(1e-7, 1 - 1e-7), targets).item(),
        "brier": ((probabilities - targets) ** 2).mean().item(),
        "accuracy": ((probabilities >= 0.5) == (targets >= 0.5)).float().mean().item(),
    }


def evaluate(model, inputs, targets):
    model.eval()
    with torch.no_grad():
        probabilities = torch.cat([model.predict(chunk) for chunk in inputs.split(1024)])
    return metrics(probabilities, targets)


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
    args = parser.parse_args()
    if not 1 <= args.hidden <= 512 or min(args.epochs, args.patience, args.batch_size, args.threads) < 1 \
            or not 0 < args.learning_rate < 1 or not 0 <= args.seed <= 0xffffffff:
        parser.error("Invalid training parameters")
    if args.output.exists():
        parser.error("Output already exists; choose a new directory")
    manifest = json.loads((args.dataset / "manifest.json").read_text(encoding="utf8"))
    if manifest.get("version") != 1 or manifest.get("features") != PATTERN_FEATURES:
        parser.error("Unsupported pattern dataset")
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)
    torch.manual_seed(args.seed)
    random.seed(args.seed)
    _, train_x, train_y = load_split(args.dataset, "train")
    _, validation_x, validation_y = load_split(args.dataset, "validation")
    model = PatternEval(args.hidden)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=0.0001)
    baseline = metrics(torch.full_like(validation_y, train_y.mean().item()), validation_y)
    args.output.mkdir(parents=True)
    history, best, best_epoch, best_state = [], float("inf"), 0, None
    for epoch in range(1, args.epochs + 1):
        model.train()
        loss_sum = 0.0
        for indices in torch.randperm(len(train_x)).split(args.batch_size):
            optimizer.zero_grad(set_to_none=True)
            loss = F.binary_cross_entropy_with_logits(model(train_x[indices]), train_y[indices])
            loss.backward()
            optimizer.step()
            loss_sum += loss.item() * len(indices)
        validation = evaluate(model, validation_x, validation_y)
        current = validation["crossEntropy"]
        history.append({"epoch": epoch, "trainCrossEntropy": loss_sum / len(train_x),
                        "validationCrossEntropy": current, "validationAccuracy": validation["accuracy"]})
        if current < best - 1e-6:
            best, best_epoch = current, epoch
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
        elif epoch - best_epoch >= args.patience:
            break
    model.load_state_dict(best_state)
    export_pattern_model(model, args.output / "model.pattern")
    portable = PortablePattern(args.output / "model.pattern")
    maximum_error = 0.0
    model.eval()
    with torch.no_grad():
        for index in range(min(2048, len(validation_x))):
            expected = model(validation_x[index : index + 1]).item()
            maximum_error = max(maximum_error, abs(expected - portable.logit(validation_x[index].tolist())))
    if maximum_error > 1e-4:
        raise RuntimeError("Portable pattern model disagrees with PyTorch")
    report = {
        "version": 1,
        "architecture": f"{PATTERN_FEATURES} -> ReLU({args.hidden}) -> 1 sigmoid",
        "objective": "binary cross-entropy on side-to-move win probability",
        "parameters": {k: str(v) if isinstance(v, Path) else v for k, v in vars(args).items()},
        "environment": {"python": platform.python_version(), "torch": str(torch.__version__),
                        "numpy": version("numpy"), "platform": platform.platform()},
        "trainerSha256": hashlib.sha256(b"".join(Path(__file__).with_name(name).read_bytes()
                                                 for name in ("pattern_train.py", "pattern_model.py"))).hexdigest(),
        "datasetManifestSha256": digest(args.dataset / "manifest.json"),
        "trainPositions": len(train_x), "validationPositions": len(validation_x),
        "constantBaseline": baseline, "bestEpoch": best_epoch,
        "validation": evaluate(model, validation_x, validation_y),
        "history": history,
    }
    checkpoint = {"version": 1, "hidden": args.hidden, "features": PATTERN_FEATURES,
                  "bestEpoch": best_epoch, "state_dict": best_state}
    torch.save(checkpoint, args.output / "best.pt")
    (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
    print(json.dumps({k: v for k, v in report.items() if k != "history"}, indent=2))


if __name__ == "__main__":
    main()


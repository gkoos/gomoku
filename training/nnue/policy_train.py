"""Train and evaluate the candidate-ordering policy on teacher move labels."""
import argparse
import hashlib
import json
import platform
import random
from importlib.metadata import version
from pathlib import Path

import torch
from torch.nn import functional as F

from policy_model import Policy, POLICY_FEATURES, FEATURE_LAYOUT


def digest(filename):
    return hashlib.sha256(Path(filename).read_bytes()).hexdigest()


def load_split(directory, split):
    rows = [json.loads(line) for line in (directory / f"{split}.jsonl").read_text(encoding="utf8").splitlines()]
    if not rows:
        raise ValueError(f"Empty {split} split")
    examples = []
    for row in rows:
        if not isinstance(row["n"], int) or row["n"] < 1 or len(row["f"]) != row["n"] * POLICY_FEATURES \
                or not isinstance(row["target"], int) or not 0 <= row["target"] < row["n"]:
            raise ValueError(f"Invalid policy sample {row.get('id')}")
        values = torch.tensor(row["f"], dtype=torch.float32).reshape(row["n"], POLICY_FEATURES)
        if not torch.isfinite(values).all():
            raise ValueError("Non-finite feature")
        examples.append((values, row["target"], row["tac"]))
    return examples


def batches(examples, batch_size, shuffle):
    order = list(range(len(examples)))
    if shuffle:
        random.shuffle(order)
    for start in range(0, len(order), batch_size):
        chunk = [examples[i] for i in order[start:start + batch_size]]
        width = max(values.shape[0] for values, _, _ in chunk)
        inputs = torch.zeros((len(chunk), width, POLICY_FEATURES))
        mask = torch.zeros((len(chunk), width), dtype=torch.bool)
        targets = torch.zeros(len(chunk), dtype=torch.long)
        for i, (values, target, _) in enumerate(chunk):
            inputs[i, : values.shape[0]] = values
            mask[i, : values.shape[0]] = True
            targets[i] = target
        yield inputs, mask, targets


def scores_for(model, inputs, mask):
    return model(inputs).masked_fill(~mask, float("-inf"))


def rank_of(row_scores, target):
    order = torch.argsort(row_scores, descending=True, stable=True)
    return int((order == target).nonzero(as_tuple=True)[0].item())


def summarize(ranks):
    if not ranks:
        return {"positions": 0}
    count = len(ranks)
    return {
        "positions": count,
        "top1": sum(rank == 0 for rank in ranks) / count,
        "top8": sum(rank < 8 for rank in ranks) / count,
        "mrr": sum(1 / (rank + 1) for rank in ranks) / count,
        "meanRank": sum(ranks) / count,
    }


def ranks_for(model, examples):
    model.eval()
    ranks = []
    with torch.no_grad():
        for inputs, mask, targets in batches(examples, 512, False):
            scores = scores_for(model, inputs, mask)
            for i in range(scores.shape[0]):
                ranks.append(rank_of(scores[i], int(targets[i])))
    return ranks


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--patience", type=int, default=8)
    parser.add_argument("--hidden", type=int, default=64)
    parser.add_argument("--batch-size", type=int, default=64)
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
    if manifest.get("version") != 1 or manifest.get("features") != POLICY_FEATURES:
        parser.error("Unsupported policy dataset")
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)
    torch.manual_seed(args.seed)
    random.seed(args.seed)
    train = load_split(args.dataset, "train")
    validation = load_split(args.dataset, "validation")
    model = Policy(args.hidden)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=0.0001)

    def validation_loss():
        model.eval()
        total, count = 0.0, 0
        with torch.no_grad():
            for inputs, mask, targets in batches(validation, 512, False):
                total += F.cross_entropy(scores_for(model, inputs, mask), targets, reduction="sum").item()
                count += len(targets)
        return total / count

    args.output.mkdir(parents=True)
    history, best, best_epoch, best_state = [], float("inf"), 0, None
    for epoch in range(1, args.epochs + 1):
        model.train()
        loss_sum = 0.0
        for inputs, mask, targets in batches(train, args.batch_size, True):
            optimizer.zero_grad(set_to_none=True)
            loss = F.cross_entropy(scores_for(model, inputs, mask), targets)
            loss.backward()
            optimizer.step()
            loss_sum += loss.item() * len(targets)
        current = validation_loss()
        history.append({"epoch": epoch, "trainCrossEntropy": loss_sum / len(train),
                        "validationCrossEntropy": current})
        if current < best - 1e-6:
            best, best_epoch = current, epoch
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
        elif epoch - best_epoch >= args.patience:
            break
    model.load_state_dict(best_state)

    policy_ranks = ranks_for(model, validation)
    baseline_ranks = [target for _, target, _ in validation]
    quiet = [i for i, (_, _, tactical) in enumerate(validation) if not tactical]
    report = {
        "version": 1,
        "architecture": f"{POLICY_FEATURES} -> ReLU({args.hidden}) -> 1",
        "featureLayout": FEATURE_LAYOUT,
        "objective": "listwise softmax cross-entropy over candidates, target = teacher pv[0]",
        "parameters": {k: str(v) if isinstance(v, Path) else v for k, v in vars(args).items()},
        "environment": {"python": platform.python_version(), "torch": str(torch.__version__),
                        "numpy": version("numpy"), "platform": platform.platform()},
        "trainerSha256": hashlib.sha256(b"".join(Path(__file__).with_name(name).read_bytes()
                                                 for name in ("policy_train.py", "policy_model.py"))).hexdigest(),
        "datasetManifestSha256": digest(args.dataset / "manifest.json"),
        "trainPositions": len(train), "validationPositions": len(validation),
        "bestEpoch": best_epoch, "validationCrossEntropy": best,
        "baseline": summarize(baseline_ranks), "policy": summarize(policy_ranks),
        "baselineQuiet": summarize([baseline_ranks[i] for i in quiet]),
        "policyQuiet": summarize([policy_ranks[i] for i in quiet]),
        "history": history,
    }
    checkpoint = {"version": 1, "hidden": args.hidden, "features": POLICY_FEATURES,
                  "bestEpoch": best_epoch, "state_dict": best_state}
    torch.save(checkpoint, args.output / "best.pt")
    (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
    print(json.dumps({k: v for k, v in report.items() if k != "history"}, indent=2))


if __name__ == "__main__":
    main()


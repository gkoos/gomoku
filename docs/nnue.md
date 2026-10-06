# NNUE training and inference

The experimental trainer learns an efficiently updatable evaluator from the [self-play dataset](datasets.md). It trains offline on CPU, exports a portable floating-point model, and checks full versus incremental inference. Production move selection still uses the handcrafted Rust evaluator; experimental Rust/Wasm inference is available for self-play, with its first match results below.

## Setup and commands

The recorded run used Python 3.10.11 and CPU-only PyTorch 2.10.0. Dependencies are pinned in `training/nnue/requirements-cpu.txt`. Create a local environment in Windows PowerShell:

```powershell
python -m venv .venv-nnue
.venv-nnue/Scripts/python.exe -m pip install --upgrade pip
.venv-nnue/Scripts/python.exe -m pip install -r training/nnue/requirements-cpu.txt
```

On Linux/macOS, replace `Scripts/python.exe` with `bin/python`. The npm wrapper discovers this local environment; `NNUE_PYTHON` can select another interpreter. Neither Python nor PyTorch is needed to build or play the web application. The CPU package source follows [PyTorch's installation instructions](https://pytorch.org/get-started/previous-versions/).

After exporting the dataset:

```powershell
npm.cmd run nnue:train -- --dataset=.selfplay/nnue-dataset-v1-balanced --output=.training/nnue-outcome-v1 --epochs=40 --seed=42 --threads=2
npm.cmd run nnue:test
npm.cmd run nnue:benchmark -- --model=.training/nnue-outcome-v1/model.nnue --positions=.selfplay/nnue-dataset-v1-balanced/validation.jsonl --output=.training/nnue-outcome-v1/benchmark.json
```

Use a fresh output directory for another training run. Direct `node scripts/run-nnue.js train ...` calls also work. Options include hidden width (default 64), batch size (256), learning rate (0.001), patience (8), seed (42), and CPU threads (2).

## Architecture and targets

The network has 452 binary input features, one 64-unit additive layer, clipped-ReLU activation in [0, 1], and a single linear output followed by sigmoid:

- Features 0–224: Black stones at those squares.
- Features 225–449: White stones at square `feature - 225`.
- Feature 450: Black to move; feature 451: White to move.

The additive accumulator is `bias + sum(active feature vectors)`. Making a move adds its stone vector, subtracts the old side-to-move vector, and adds the new side vector. The reference implementation saves the previous accumulator for exact undo. The output is a side-to-move outcome probability. Rust search converts its logit to a bounded score using an explicit scale, as described below.

Training uses `(outcome + 1) / 2`, with binary cross-entropy and AdamW (weight decay 0.0001). Every unique position has equal weight; duplicated game observations are not expanded into repeated training examples. Raw search labels remain available in the dataset but are not used in this first outcome-only experiment. Random rotations/reflections augment each training position each epoch; colours and side to move remain unchanged. Augmentation encourages symmetry consistency but does not mathematically guarantee it.

The trainer verifies dataset output hashes, unique positions, disjoint groups, board features, and outcome counts. Validation is used for checkpoint selection and early stopping. Its results therefore describe model development; a separate fresh test set or engine match suite is needed for final strength claims.

## Artifacts and numerical checks

The output directory contains:

- `best.pt`: selected PyTorch state dictionary plus architecture and dataset identity; an inference checkpoint, not an optimizer/resume checkpoint.
- `model.nnue`: portable weights for future Rust inference.
- `report.json`: parameters, runtime versions, trainer/dataset hashes, epoch history, validation metrics, symmetry diagnostics, numerical checks, and model hash.

The binary format uses a 24-byte little-endian header: eight-byte magic `GOMNNUE1`, then four uint32 values (version 1, input count 452, hidden width, output count 1). The remaining values are float32: feature-major vectors, hidden bias, output weights, and output bias. Activation and sigmoid semantics are defined by version 1. The reader rejects unsupported headers, wrong lengths, and nonfinite weights. This is a floating-point prototype; quantisation remains future work; the Rust/Wasm loader supports this format.

For every validation position, exported inference is compared with PyTorch. A separate 225-placement/undo sequence checks accumulator restoration. Tests cover sparse features, colour-preserving symmetry mappings, malformed model files, illegal updates, dataset integrity, and split leakage.

## Recorded result

Using 12,541 training positions and 2,742 validation positions, the selected checkpoint was epoch 4. Early stopping ended training at epoch 12:

| Validation measure | Constant training-mean baseline | NNUE |
| --- | ---: | ---: |
| Cross-entropy | 0.693164 | 0.682409 |
| Brier score | 0.227787 | 0.222454 |

The eight-symmetry prediction ensemble scored 0.682175 cross-entropy; the primary metrics above use one orientation, as the reference incremental evaluator does. Mean standard deviation across orientation predictions was 0.015744. Later epochs improved training loss while worsening validation loss, indicating overfitting on this small corpus.

Two seeded runs produced identical portable model bytes, SHA-256 `4a0b72a6b9ee3347f154841a143f9442e2a1170b27944e6083bf91b114aa1fd0`. The model has 29,057 parameters and occupies 116,252 bytes, including its header. Maximum portable-versus-PyTorch probability error was approximately 5.9e-8; the recorded incremental sequence had zero observed probability error.

The repeated run's report and weights are saved locally in `.training/nnue-outcome-v1-repeat`. Training outputs and virtual environments are ignored by Git. Seeds and deterministic CPU operations make this experiment rerunnable in the recorded environment; [PyTorch does not guarantee exact reproducibility across releases or platforms](https://docs.pytorch.org/docs/stable/notes/randomness.html).

The repeatable Python reference benchmark samples 64 validation positions, alternates timings, and verifies the moved position before measuring. Median full inference was 176.1 microseconds versus 26.1 microseconds for make/predict/undo, about 6.7× faster. This compares two Python reference paths; it does not measure Rust/Wasm performance or demonstrate stronger play.

## Rust/Wasm inference and first playing test

The engine now supports experimental NNUE inference through
`MoveEngine.with_nnue(black, white, computerBlack, difficulty, extension,
tableCapacity, modelBytes, logitScale)`. The ordinary constructor still uses
the handcrafted evaluator. The browser game continues to use that constructor.

The loader validates the binary header, dimensions, exact length, finite
coefficients, and scale. Make adds one stone feature vector to a maintained
accumulator. Undo restores its saved accumulator exactly. Side-to-move features
are added when evaluating the head, allowing search to pass the actual turn
explicitly. NNUE searches skip the handcrafted contribution updates but retain
line boards, winning-square caches, density, candidate generation, and tactical
search. Root shortcuts remain shared with the existing engine.

Search uses `round(logit * scale)` from the side-to-move perspective, converts
it to the computer's perspective, and clamps it to ±500,000. Forced wins keep
their existing ±1,000,000 distance scoring. The default experimental scale is
1,000; it has not been tuned. Each search owns a fixed model, so its transposition
table never mixes evaluators. This implementation uses float32 coefficients and
an accumulator snapshot per move; quantization and allocation optimizations are
future work.

After building Wasm, reproduce the reference comparison and paired match with:

```powershell
npm.cmd run wasm:build
npm.cmd run nnue:wasm-check -- --model=.training/nnue-outcome-v1-repeat/model.nnue --positions=.selfplay/nnue-dataset-v1-balanced/validation.jsonl
npm.cmd run selfplay -- --games=100 --depth=4 --seed=32 --nnue-b=.training/nnue-outcome-v1-repeat/model.nnue --nnue-scale=1000 --output=.selfplay/nnue-first-depth4.jsonl
```

The match runner also accepts `--nnue-a`. Model SHA-256 and scale are recorded
in run provenance and checked on resume. Custom handcrafted weights and NNUE
are mutually exclusive for the same player. Exported teacher labels retain
NNUE model identity and scale when present.

The recorded model produced a maximum probability error of
2.53 × 10⁻⁸ against the portable Python reference across 512 validation boards
with both sides to move. Synthetic regression tests cover all 225 placements,
both turn features, exact undo restoration, perspective conversion, invalid
models, and immediate-win root selection.

In the first 100-game match at depth four, NNUE won 20, drew 2, and lost 78:
a **21% score**. Openings were paired with colors swapped. A separate 20-game
depth-two smoke test scored 15% (3 wins, 17 losses). These are exploratory
results from a single model and scale, using the shared search and root tactics;
the openings have not been certified disjoint from training positions. They
show that this outcome-trained model is not ready to replace the handcrafted
evaluator. Better training targets, data coverage, and architecture should be
tested before enabling NNUE in the game.

The [stronger-search training experiment](nnue-search-targets.md) adds resumable
depth-six teacher labels, search-target training, and paired-match reporting
with opening-overlap checks.

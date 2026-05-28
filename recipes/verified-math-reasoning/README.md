---
license: cc-by-nc-sa-4.0
language:
  - en
task_categories:
  - text-generation
  - text2text-generation
tags:
  - math
  - reasoning
  - olympiad
  - cot
  - rlvr
  - cargodash
  - synthetic
size_categories:
  - n<1K
extra_gated_prompt: >-
  This dataset contains AI-generated content (sol_a / sol_b / sol_c) subject
  to the upstream model providers' Terms of Service. Please read NOTICE.md
  before redistributing; commercial use of sol_b (Volcengine Doubao output)
  requires prior written permission from Volcengine per their §3.1.
---

# verified-math-reasoning (CargoDash flagship recipe)

**A CargoDash framework demonstration.** 999-row showcase of three-layer,
program-verified, vote-stratified math reasoning traces — the dataset is
small *on purpose* (its job is to prove the framework works on real
production LLM endpoints, not to be a serious math benchmark). Each row
carries three independent chain-of-thought solutions to the same problem
(from DeepSeek, Doubao, and Qwen3.5) plus a programmatically extracted
`\boxed{}` answer from each, compared numerically against the NuminaMath
reference. Rows are routed by *how many models got it right* into three
splits:

| split | criterion | size (v0.1) | use case |
|---|---|---:|---|
| `train_clean.jsonl` | all 3 models agreed on the correct answer | **524** | high-confidence SFT / distillation |
| `hard_disagreement.jsonl` | 1 or 2 of 3 models got it right | **312** | **the disagreement set** — hard-benchmark / RLVR difficulty data |
| `unsolved_flagged.jsonl` | all 3 failed | **163** | suspect-hard or suspect-reference — review before training |
| **total** | | **999** | (1000 seeds — 1 contaminated row dropped, see below) |

The pipeline that produced this dataset is reproducible from this repo: `pipeline.py` (~180 lines of [CargoDash](https://github.com/Berdyanskov/CargoDash)). The *why* behind the design lives in [`DESIGN.md`](DESIGN.md); the operational gotchas (model quirks, network plumbing, parameter choices) live in [`CLAUDE.md`](CLAUDE.md).

## Quick load

```python
import json
from pathlib import Path

ROOT = Path("recipes/verified-math-reasoning")
for split in ("train_clean", "hard_disagreement", "unsolved_flagged"):
    rows = [json.loads(l) for l in (ROOT / f"out_{split}.jsonl").open()]
    print(f"{split}: {len(rows)} rows; first ref = {rows[0]['reference_answer']}")
```

Or with [`datasets`](https://huggingface.co/docs/datasets) once mirrored to the
HuggingFace Hub:

```python
from datasets import load_dataset
ds = load_dataset("Berdyanskov/verified-math-reasoning")   # tentative path
```

## Schema

Every row in every split follows one unified schema:

| field | type | meaning |
|---|---|---|
| `id` | str | unique row id, e.g. `numina-olympiads-0000523` |
| `source` | str | seed dataset of origin (`numina:olympiads`) |
| `problem` | str | problem statement (English, LaTeX) |
| `reference_answer` | str | normalized numeric answer from NuminaMath |
| `sol_a` / `sol_b` / `sol_c` | str | full CoT from DeepSeek / Doubao / Qwen3.5 respectively |
| `ans_a` / `ans_b` / `ans_c` | str | extracted `\boxed{}` answer from each model |
| `correct_a` / `correct_b` / `correct_c` | bool | numerically equal to `reference_answer` |
| `num_correct` | int | 0–3, the bucket key |
| `difficulty` | str | `easy` / `hard` / `unsolved` (mirrors the split) |
| `split` | str | `train_clean` / `hard_disagreement` / `unsolved_flagged` |
| `synthetic` | bool | `true` for every published row — explicit AI-generated-content label per China's《人工智能生成合成内容标识办法》 |

### Sample row (from `hard_disagreement.jsonl`)

```json
{
  "id": "numina-olympiads-0000001",
  "source": "numina:olympiads",
  "problem": "Problem 2. Let n three-digit numbers satisfy ... Find the largest possible value of n.",
  "reference_answer": "5",
  "sol_a": "Alright, let's break this down ... \\boxed{7}",
  "sol_b": "### Step 1: Translate the problem ... \\boxed{5}",
  "sol_c": "We are given ... \\boxed{5}",
  "ans_a": "7", "ans_b": "5", "ans_c": "5",
  "correct_a": false, "correct_b": true, "correct_c": true,
  "num_correct": 2,
  "difficulty": "hard",
  "split": "hard_disagreement"
}
```

## Producing models

| field | model | endpoint family | role |
|---|---|---|---|
| `sol_a` | DeepSeek-V4-Pro (`deepseek-reasoner`) | DeepSeek API or self-host vLLM | strong reasoner |
| `sol_b` | `doubao-seed-2-0-pro-260215` | Volces ARK | strong reasoner (paid) |
| `sol_c` | `Qwen3.5-397B-A17B`, `enable_thinking=False` | DashScope or self-host vLLM | fast non-reasoner — the heterogeneous third voice |

Choosing one non-reasoning model as the third voice is a deliberate design choice; see [`DESIGN.md §3`](DESIGN.md) and [`CLAUDE.md`](CLAUDE.md) for why pure-reasoning triplets are noisier.

## Reproduce

From the CargoDash repo root:

```bash
pip install -e ".[openai]"

export DEEPSEEK_API_KEY=...   # api.deepseek.com (or override DEEPSEEK_BASE_URL)
export DOUBAO_API_KEY=...     # ark.cn-beijing.volces.com
export QWEN_API_KEY=...       # dashscope.aliyuncs.com (or override QWEN_BASE_URL)

# Small smoke test (3 rows, output to *.dryrun.jsonl, originals preserved):
python -c "
import sys; sys.path.insert(0, 'recipes/verified-math-reasoning')
import pipeline
pipeline.Pipeline(pipeline.source).run(dry_run_rows=3)
"

# Full run (overwrites the existing v0.1 dataset):
python recipes/verified-math-reasoning/pipeline.py
```

Wall-time for v0.1 was **3h 39min** on the three SII-hosted vLLM + paid Doubao endpoints with `batch_size=16, intra_batch_workers=8`. Public-endpoint reproduction will be slower (rate limits on free tiers).

### Need new seeds?

```bash
# Regenerate or extend the seed jsonl from NuminaMath-1.5 (HuggingFace):
python recipes/verified-math-reasoning/load_numina.py \
    --out _numina_1k.jsonl --limit 1000
```

Filters to "numeric scalar answer" by default; pass `--no-scalar-only` to keep symbolic / interval answers (verifier coverage there is partial).

## What's verified, what isn't

✅ **Verified by construction**
- Every `correct_x` is the result of a programmatic numeric comparison (sympy-backed `numeric_equal` with unit-stripping for `^\circ` / `\%` / `°`), not model self-rating.
- Every row has all three `sol_a/b/c` non-empty (3000/3000 model calls succeeded in the v0.1 run).
- Each row appears in exactly one split.

⚠️ **Caveats — read before training on this data**
1. **Decontamination**: `decontam.py` checks each seed against MATH-500 (500 problems), GSM8K-test (1319), and AI-MO's AIME validation (90) — total 1909 problems / 69k 10-word shingles. Two-layer match: (a) normalized exact-string equality, (b) ≥3 shared 10-word shingles (catches paraphrases). Out of 1000 NuminaMath seeds, **1 contamination hit** was found and dropped (final size: **999**). Coverage is *not* research-grade — LLM-based paraphrase detection (Yang et al. 2023) and broader benchmark sets (OmniMath, OlympiadBench) are not implemented here. **This dataset is a CargoDash framework demo, not a benchmark-quality math eval** — if you need contamination-clean evaluation data, use a properly audited source.
2. **`unsolved_flagged` is not curated.** A row landing there might be (a) genuinely too hard for all three models, (b) a `reference_answer` mismatch (NuminaMath sometimes encodes the answer in a non-standard form the verifier misses), or (c) extraction failure (model wrote the answer outside `\boxed{}`). Manual spot-check before treating it as a benchmark.
3. **Licensing is layered** — the seed text (NuminaMath-1.5) is Apache-2.0, the dataset itself is released under **CC-BY-NC-SA 4.0** (see [`LICENSE-DATA.txt`](LICENSE-DATA.txt)), and the model-generated `sol_a/b/c` traces are *additionally* constrained by each upstream provider's terms. Detailed clauses + per-column attribution live in [`NOTICE.md`](NOTICE.md) — **read it before any redistribution**.
4. **Verifier coverage**: `numeric_equal` handles integers, decimals, fractions, `\frac{}{}`, `\sqrt{}`, `\pi`, basic symbolic expressions via sympy, and unit suffixes (degrees, percent). Intervals (`[1, 2]`), vectors, set-valued answers, and proofs are out of scope in v0.1.

## Upstream model terms

The three `sol_*` columns are AI-generated content; redistribution is governed by **both** this dataset's CC-BY-NC-SA license **and** each producing model's Terms of Service. The clauses we identified as material at release time:

| field | model | provider | redistribute | train downstream models | special restriction |
|---|---|---|---|---|---|
| `sol_a` | DeepSeek-V4-Pro | [DeepSeek](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html) | ✅ | ✅ explicit, including distillation | none |
| `sol_b` | Doubao-seed-2.0-pro | [Volcengine ARK](https://www.volcengine.com/docs/82379/1104498) | ✅ non-commercial | ✅ outside Volcengine platform | §3.1 mainland-China license + **written permission required for commercial use**; §3.7.12 AI-content labeling |
| `sol_c` | Qwen3.5-397B-A17B | [Aliyun 百炼](https://terms.alicdn.com/legal-agreement/terms/common_platform_service/20230728213935489/20230728213935489.html) | ✅ (user owns §7.5) | ⚠️ **§4.6 prohibits training Qwen-competing products** without written permission | — |

Each output row carries `synthetic: true` as the explicit AI-content label per China's《人工智能生成合成内容标识办法》. Full clause-level analysis + downstream-user guidance in [`NOTICE.md`](NOTICE.md).

## v0.1 production stats

- 1000 seeds → 1000 rows out of the pipeline (no data loss, no `JoinById` deadlocks); 1 contaminated row removed post-hoc → **999 published rows**
- 13 transient retries across 3000 LLM calls (0 exhausted)
- 0 rows with empty `sol_x`
- 3h 39min total wall time
- Cost: free for DeepSeek (self-host vLLM) and Qwen (self-host vLLM); ~$50 for Doubao API

## Files in this directory

| file | role |
|---|---|
| `pipeline.py` | The CargoDash pipeline that produced the dataset (~180 lines) |
| `verifier.py` | `extract_boxed_or_number` + `numeric_equal` + decontam |
| `load_numina.py` | Convert NuminaMath-1.5 (HF parquet) to seed jsonl |
| `test_verifier.py` | Verifier unit tests + 1000-row round-trip sanity |
| `_numina_1k.jsonl` | 1000 NuminaMath olympiad seeds (input) |
| `_demo_seeds.jsonl` | 5-row hand-crafted demo seeds (offline mock testing) |
| `out_train_clean.jsonl` | **dataset output** — 524 rows, all 3 models agreed |
| `out_hard_disagreement.jsonl` | **dataset output** — 312 rows, partial agreement |
| `out_unsolved_flagged.jsonl` | **dataset output** — 163 rows, no model correct |
| `DESIGN.md` | Architecture & rationale (developer-facing) |
| `CLAUDE.md` | Operational gotchas / why decisions were made (auto-loaded by Claude Code) |
| `README.md` | This file (dataset-consumer-facing) |

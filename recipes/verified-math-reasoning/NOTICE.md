# NOTICE — verified-math-reasoning dataset

This dataset contains AI-generated synthetic content. Read this NOTICE before
using or redistributing the dataset.

## What's in this dataset

| File | Content | License |
|---|---|---|
| `_demo_seeds.jsonl`, `_numina_1k.jsonl` | Problem text + reference answers, sourced from [NuminaMath-1.5](https://huggingface.co/datasets/AI-MO/NuminaMath-1.5) | Apache-2.0 (upstream) |
| `out_train_clean.jsonl`, `out_hard_disagreement.jsonl`, `out_unsolved_flagged.jsonl` | Each row contains 3 AI-generated chain-of-thought solutions (`sol_a`, `sol_b`, `sol_c`) to a NuminaMath problem | **CC-BY-NC-SA 4.0** (this dataset) — see [LICENSE-DATA.txt](LICENSE-DATA.txt) |

Every row in the output files carries `synthetic: true` (explicit AI-content
flag, per China's [《人工智能生成合成内容标识办法》](https://www.cac.gov.cn/) labeling requirements).

## Per-column attribution

| field | producing model | endpoint family | provider terms |
|---|---|---|---|
| `sol_a` | DeepSeek-V4-Pro (or `deepseek-reasoner`) | api.deepseek.com (or self-hosted vLLM) | [DeepSeek Open Platform ToS](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html) |
| `sol_b` | `doubao-seed-2-0-pro-260215` | Volcengine ARK (ark.cn-beijing.volces.com) | [火山方舟大模型服务平台专用条款](https://www.volcengine.com/docs/82379/1104498) |
| `sol_c` | `Qwen3.5-397B-A17B` (with `enable_thinking=False`) | DashScope (or self-hosted vLLM) | [阿里云百炼服务协议](https://terms.alicdn.com/legal-agreement/terms/common_platform_service/20230728213935489/20230728213935489.html) |

## Upstream-provider restrictions you (downstream user) inherit

The output rows are AI-generated content; they are subject to each producing
model's terms in addition to this dataset's CC-BY-NC-SA license. The relevant
clauses we identified at release time:

### DeepSeek (`sol_a`)

DeepSeek's Open Platform Terms of Service explicitly permit using API outputs
for *"personal use, academic research, derivative product development, training
other models (such as model distillation)"*. **Outputs are free to redistribute
and use for downstream training**, including competitive training.

### Volcengine ARK / Doubao (`sol_b`)

The Volcengine ARK service terms have **three** practical restrictions
relevant to redistribution:

- **§3.1** — License is "non-exclusive, non-transferable, non-sublicensable,
  ..., **for use within mainland China only**" and **"commercial use or any
  direct or indirect monetization requires prior written permission from
  Volcengine"**. We release this dataset under CC-BY-**NC**-SA to honor
  the non-commercial-without-permission constraint, and we cannot guarantee
  the mainland-China geographic clause permits international redistribution
  — downstream users outside mainland China assume that risk themselves.
- **§3.7.13** — API-generated content (which `sol_b` is) belongs to the user
  and may be used "in compliance with the model service agreement and
  applicable law". Outputs from Volcengine's "experience center" (体验中心)
  are *separately* prohibited from redistribution; `sol_b` was generated via
  direct API calls, not the experience center, so this prohibition does not
  apply.
- **§3.7.12** — Mandatory labeling of AI-generated content per Chinese
  regulations. The `synthetic: true` per-row flag plus this NOTICE constitute
  the explicit label; an implicit watermark in the text content is not
  applied (text-data watermarking is not yet standardized).

A separate **Doubao model service agreement** between ByteDance and the
publisher may exist (per §3.7.2). We have not located its full text; if it
adds restrictions stricter than the ARK terms above, those apply to
redistribution of `sol_b`.

### Aliyun Bailian / Qwen (`sol_c`)

The Aliyun Bailian service agreement is the friendliest of the three on
output IP but adds a competitive-training restriction:

- **§7.5** — "The intellectual property of synthesized content belongs to
  you" (IP of `sol_c` belongs to the publisher). This permits redistribution.
- **§4.6** — Outputs may **not** be used (without written permission) to
  "train or develop products or services that compete with the model
  service or models provided by Aliyun and its affiliates." Downstream
  users who fine-tune a model from `sol_c` aimed at competing with Qwen
  need separate written permission from Aliyun.

## What this means in practice for downstream users

- **OK by default**: academic research, personal study, derivative work that
  doesn't compete with the producing models, demonstrations of data-synthesis
  techniques, non-commercial use.
- **OK with caveats**: training models on this data for personal or research
  use (DeepSeek explicitly permits; Aliyun permits if the trained model is
  not a Qwen competitor; Volcengine requires that the use stay non-commercial
  or that you obtain written permission for commercial use).
- **NOT OK without separate written permission from the relevant provider**:
  (a) using `sol_b` for commercial purposes outside mainland China,
  (b) using `sol_c` to train a model competitive with Qwen,
  (c) reselling the raw `sol_a/b/c` content as a service.

## Disclaimer

This dataset is released as a **CargoDash framework demonstration**, not as a
benchmark or production training corpus. Contamination is checked
heuristically (`decontam.py`) against three public test sets — coverage is
incomplete by design. No human review of individual rows; AI-generated content
may contain errors, biases, or harmful content despite the program-verifier's
numeric correctness check.

The verifier marks each `sol_x` as `correct` or not on the basis of *final
numeric answer match only*. The intermediate reasoning may be unsound even
when `correct_x = true`. Do not use this data for safety-critical or
regulatory decisions.

<p align="center">
  <img src="assets/images/LOGO.png" alt="CargoDash" width="320">
</p>

# CargoDash

> 🇨🇳 **中文用户请看 [README_ch.md](README_ch.md)** — 本文件是其英文镜像。

> ⚠️ **Preview release (v0.2.1)**: APIs and internals may still change without compatibility guarantees. Feedback and issues are welcome; not yet recommended for production use.

CargoDash is a Python library for building **simple, modular, versatile, and efficient** LLM training-data synthesis & augmentation pipelines. Core idea: any data-processing pipeline can be expressed by nesting two primitives — **sequence** and **branch**.

## New in v0.2.1

- **WebUI visual pipeline editor (preview)**: drag nodes onto a canvas, wire them up, fill in parameters, and export `pipeline.py` in one click — build a pipeline without writing Python. See the [WebUI](#webui-visual-pipeline-editor) section below.

## New in v0.2

- **`LLMCall` — one-line LLM nodes**: just `prompt + model + api_key` produces a callable you can drop into a `Processor`. Set `base_url` to any OpenAI-compatible gateway (DeepSeek / Moonshot / Zhipu / vLLM / SGLang / Ollama, etc.).
- **`ChatClient` protocol layer**: extracted `ChatClient` / `OpenAICompatChatClient` / `MockChatClient`. Adding native vLLM / SGLang protocols only requires a new subclass.
- **`Processor` collapsed to a single class**: the old `MapProcessor` is merged in, with `mode="sample"` (default) / `mode="batch"`. Calling LLMs uses `mode="sample" + intra_batch_workers=N` for batch-internal concurrency.
- **Execution fault-tolerance fix**: when any node raises, the executor guarantees SENTINEL propagation to all downstreams and switches to drain mode on entry queues — no more cascading deadlock. The error is re-raised verbatim.

## Features

- **Three core primitives**: `Processor` (sequential), `Judge` (branching, sample / batch granularity), `Vote` (multi-model voting, usable as a `Judge` predicate).
- **`LLMCall`, one line to call a model**: built-in OpenAI-compatible client covers OpenAI / DeepSeek / Zhipu / Moonshot / Qwen / vLLM / SGLang / Ollama and more.
- **Batches as the flow unit**: streaming batches between modules; `batch_size = 1` naturally degenerates to per-row processing.
- **DAG via Python operators**: `>>` connects nodes; `Judge.on_true` / `on_false` are named ports for branches; convergence is identified by object identity.
- **Strongly-typed schema**: built on `pyarrow.Schema`, validated statically at graph-construction time, including convergence-point schema consistency.
- **Intra-batch parallelism + inter-node streaming + backpressure**: `intra_batch_workers` controls per-batch concurrency (typically: concurrent LLM calls); bounded queues between nodes provide streaming and backpressure.

## Install

Requires Python ≥ 3.10.

```bash
# GitHub
git clone https://github.com/Berdyanskov/CargoDash_preview.git

# Or Gitee (recommended in mainland China)
git clone https://gitee.com/the-call-of-volgograd/cargo-dash_preview.git

cd CargoDash_preview      # or cargo-dash_preview
pip install -e .
```

Core dependency: only `pyarrow>=15.0`. To use `LLMCall` against a real OpenAI-compatible service, also `pip install openai` (not needed for `MockChatClient`).

## Quick start

The snippet below builds a pipeline with two layers of nested branches and one convergence point: a 3-model vote filters low-quality samples, then a language branch decides whether to augment, and everything writes to a single sink.

```python
from cargodash import (
    Schema, RawDataSource, DataOutput,
    Processor, Judge, Vote, LLMCall, Pipeline,
)

schema = Schema.of(id=int, text=str, quality=float)

source = RawDataSource("in.jsonl", schema=schema, batch_size=32)
target = DataOutput("out.jsonl", schema=schema)

clean = Processor(lambda r: {**r, "text": r["text"].strip()},
                  input_schema=schema, output_schema=schema)

# LLM-call node: prompt + model name + api_key only. Output is written to
# the column named in output_field. The framework fans out within a batch
# via intra_batch_workers, and works against OpenAI / domestic OpenAI-
# compatible gateways (set base_url) / local vLLM / SGLang.
augment = Processor(
    LLMCall(
        prompt="Rewrite this sentence to make it more vivid: {text}",
        model="gpt-4.1-mini",
        api_key="sk-...",
        output_field="text",
        # base_url="https://api.deepseek.com/v1",   # gateway example
        # temperature=0.7, max_tokens=256,           # any gen kwargs are forwarded
    ),
    input_schema=schema, output_schema=schema,
    intra_batch_workers=8,
)

quality_vote = Vote(
    model_list=[model_a, model_b, model_c],   # any callable: dict -> bool
    true_num=2,
)
judge_quality = Judge(quality_vote, granularity="sample",
                      input_schema=schema, intra_batch_workers=4)
judge_lang    = Judge(is_chinese_batch, granularity="batch",
                      input_schema=schema)

# Wire up: >> is an edge; branches must come out of .on_true / .on_false
source >> clean >> judge_quality
judge_quality.on_true  >> judge_lang
judge_lang.on_true     >> augment >> target
judge_lang.on_false    >> target                  # converges into the same target
judge_quality.on_false >> Processor(log_drop, ...)   # log_drop is your own fn, e.g.
                                                     # def log_drop(row): print(row); return None
                                                     # returning None drops the sample

Pipeline(source).run()
```

A full runnable example: [`examples/basic_pipeline.py`](examples/basic_pipeline.py).

## WebUI (visual pipeline editor)

If you'd rather not write Python by hand, starting with v0.2.1 CargoDash ships a browser-based visual editor: drag nodes, connect them, fill in parameters / write fns in the right-side panel, and export `pipeline.py` with one click — then run it with `python pipeline.py`.

<p align="center">
  <img src="assets/images/webui1.png" alt="CargoDash WebUI" width="900">
</p>

**Supported nodes**: `RawDataSource` / `DataOutput` / `Processor` / `Judge` / `Vote` / `LLMCall`, one-to-one with the Python API. `Judge` exposes two output ports (`on_true` / `on_false`). `Vote` is not wired by an edge — it's referenced from a `Judge`'s properties panel and inlined as `Judge(Vote(...), ...)` at export time.

**User-defined functions**: `Processor.fn` / `Judge.predicate(code)` / `Vote.model_list[*]` are written directly in a Monaco editor inside each node's properties panel; they are emitted as top-level `def` blocks at the top of the generated `.py`. `LLMCall` uses a fully structured form instead.

**Project file**: `.cdgraph.json` is the source of truth for the graph and supports export / import for further editing. `pipeline.py` is a one-way export — regenerate it from the `.cdgraph.json` rather than hand-editing.

How to launch (requires Node.js ≥ 18):

```bash
cd webui
npm install
npm run dev          # open http://localhost:5173
```

More details: [`webui/README.md`](webui/README.md).

## Workflow overview

1. **Declare a schema**: `Schema.of(...)`, accepting Python types or `pyarrow.DataType`.
2. **Build endpoints**: `RawDataSource` (jsonl in), `DataOutput` (jsonl out).
3. **Build processing nodes**:
   - `Processor(fn, mode="sample" | "batch")`: sequential processing.
     - `mode="sample"` (default): `fn` takes a row dict and returns dict / list[dict] / None; the framework calls per-sample inside a batch with `intra_batch_workers` concurrency.
     - `mode="batch"`: `fn` takes the whole `Batch`; ideal for batch-level ops (dedup, sort).
   - `LLMCall(prompt, model, api_key, output_field=...)`: a single-turn LLM call. Pass it as the `fn` of a `Processor` to get an LLM node. `base_url` points to any OpenAI-compatible service (DeepSeek / Moonshot / Zhipu / vLLM / SGLang ...). Use `MockChatClient` for offline dry-runs without the OpenAI SDK.
   - `Judge(predicate, granularity="sample" | "batch")`: branching node.
   - `Vote(model_list, true_num)`: multi-model vote, usable as a `Judge` predicate.
4. **Wire edges** with `>>` and the named ports — you've built a DAG.
5. **`Pipeline(source).run()`**: schema-validates at graph time; at run time, one worker thread per node with bounded inter-node queues for streaming + backpressure.

## Directory layout

```
CargoDash/
├── cargodash/      # Python library
│   ├── core/        # Module base class, Port, >> operator, Pipeline construction
│   ├── data_utils/  # Batch, Schema (pyarrow backend), inter-node queues
│   ├── modules/     # RawDataSource / DataOutput / Processor / Judge
│   ├── voting/      # Vote
│   ├── models/      # ChatClient abstractions + OpenAI-compat client + LLMCall
│   └── runtime/     # Execution engine (threading + bounded queue + node-failure tolerance)
└── webui/          # In-browser visual editor (React + React Flow + Monaco, one-way codegen → pipeline.py)
```

## Roadmap

Done in v0.2: core DAG / Schema / streaming + backpressure / `LLMCall` + OpenAI-compat client / node-failure tolerance.  
Done in v0.2.1: WebUI visual editor + one-way `pipeline.py` codegen.

Up next, in priority order:

- Built-in operator library (text cleaning / dedup / quality scoring / SFT conversation synthesis)
- Native vLLM / SGLang protocols (bypassing the OpenAI SDK for a more efficient local path)
- Retry / rate-limit / resume; intermediate-artifact versioning (cf. DataFlow `storage.step()`)
- Cross-batch concurrency; multi-process / distributed (threading → multiproc → Ray)
- I/O formats: parquet / csv / HuggingFace datasets
- `DataOutput` with `preserve_order=True`
- `Loop` as sugar over branch back-edges
- CLI; observability (structured logs / metrics / tracing)
- WebUI phase 2: live in-canvas validation, `pipeline.py` → graph round-trip, in-app run with live log streaming

## License

See [LICENSE](LICENSE).

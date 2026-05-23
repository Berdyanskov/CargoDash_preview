---
name: cargodash-reference
description: Authoritative API reference and semantic rules for the CargoDash LLM data-synthesis library (Processor / Judge / Vote / LLMCall / ChatClients / Schema / Pipeline). Read this before writing or completing any CargoDash pipeline script. Shared by cargodash-from-scratch and cargodash-fill-pipeline.
---

# CargoDash API reference

CargoDash expresses any data pipeline by nesting two primitives — **sequence** (`Processor`) and **branch** (`Judge`). A pipeline is a DAG of nodes wired with `>>`, driven by streaming batches. Read this whole file before generating or completing a pipeline; it is the source of truth for signatures and the semantic rules an LLM most often gets wrong.

## Public API (everything importable)

```python
from cargodash import (
    Schema, Batch,
    RawDataSource, DataOutput, Processor, Judge, Vote,
    LLMCall,
    ChatClient, OpenAICompatChatClient, MockChatClient,
    LocalHFChatClient, LocalVLLMChatClient,
    Pipeline, Module, Port,
)
```

Only import what the script uses. `pyarrow>=15` is the sole core dependency; `openai` is needed for `OpenAICompatChatClient`, and the matching extras for local clients.

## Authoritative constructor signatures

```python
RawDataSource(path, schema=None, batch_size=32, name=None)
DataOutput(path, schema=None, preserve_order=False, name=None)

Processor(fn, mode="sample", input_schema=None, output_schema=None,
          intra_batch_workers=1, name=None)
Judge(fn, granularity="sample", input_schema=None,
      intra_batch_workers=1, name=None)
Vote(model_list, true_num, prompt_list=None)

LLMCall(prompt, *, output_field="llm_output", model=None, api_key=None,
        base_url=None, system_prompt=None, client=None, **gen_kwargs)

OpenAICompatChatClient(model, api_key=..., base_url=None, **kwargs)
LocalHFChatClient(model, device="cuda", dtype=None, cache_dir=None,
                  trust_remote_code=False, max_new_tokens=512, ...)
LocalVLLMChatClient(model, served_model_name=None, dtype=None,
                    tensor_parallel_size=1, gpu_memory_utilization=0.9,
                    max_model_len=None, trust_remote_code=False, ...)
MockChatClient(...)   # offline dry-run, no openai SDK needed

Schema.of(field_name=type, ...)   # type ∈ {int, float, str, bool} or pyarrow.DataType
Pipeline(source_or_sources).run(dry_run_rows=None)
```

Do not invent kwargs not listed here. If unsure, prefer the minimal call shown in the README quick start.

## The function contracts (what you write inside nodes)

These are the only places user code lives. Each has a strict in/out contract derived from the node's schemas — honor it exactly.

- **`Processor.fn`, `mode="sample"` (default):** `def fn(row: dict) -> dict | list[dict] | None`.
  - Return a dict → one output row. Return `list[dict]` → fan-out to many rows. Return **`None` → drop the row** (acts as a filter).
  - The returned dict's keys must match `output_schema` exactly. Read only keys present in `input_schema`.
- **`Processor.fn`, `mode="batch"`:** `def fn(batch: Batch) -> Batch` — for whole-batch ops (dedup, sort). Use sparingly.
- **`Judge.fn` (predicate), `granularity="sample"`:** `def predicate(row: dict) -> bool`. `True` routes the row to `.on_true`, `False` to `.on_false`.
- **`Judge.fn`, `granularity="batch"`:** `def predicate(batch: Batch) -> bool` — one decision for the whole batch.
- **`Vote.model_list[*]`:** each is `def model(sample: dict) -> bool`. `Vote` passes if at least `true_num` models return `True`; usable directly as a `Judge` predicate.

## Wiring rules (DAG construction)

- `a >> b` adds an edge a→b. Chains: `source >> clean >> judge`.
- A `Judge` has two **named ports**: `judge.on_true >> X` and `judge.on_false >> Y`. Never wire `judge >> X` directly — always through a port.
- **Convergence is by object identity.** Two branches feeding the *same* node object converge there: `judge.on_true >> sink` and `judge.on_false >> sink` (same `sink`). Schemas at a convergence point must be consistent — the graph validates this statically.
- To drop a branch, route it to a `Processor` whose fn returns `None` (e.g. a `log_drop`), or simply don't wire it.
- `Vote` and `ChatClient`/`ModelSpec` objects are **not** wired with `>>`. A `Vote` is passed as a `Judge`'s predicate; a client is passed via `LLMCall(client=...)` or called directly inside a fn as `client.chat(...)`.
- Run with `Pipeline(source).run()`. Multiple sources: `Pipeline([src1, src2]).run()`.

## Schema rules

- `Schema.of(id=int, text=str, quality=float)` — keyword args, Python types or pyarrow types.
- A `Processor` transforms `input_schema → output_schema`; the framework validates that upstream output matches downstream input at graph-build time.
- Convergence points require all incoming branches to share the same schema. If branches diverge in columns, normalize them before they converge.

## Choosing a model client

- **`OpenAICompatChatClient`** (remote): OpenAI, DeepSeek, Moonshot, Zhipu, Qwen, or any externally-running vLLM/SGLang/Ollama. Needs `model`, `api_key`, and `base_url` for non-OpenAI gateways. `open()/close()` are no-ops.
- **`LocalHFChatClient`** (in-process transformers): small models, single GPU, debugging.
- **`LocalVLLMChatClient`** (managed `vllm serve` subprocess): serious throughput / big models. `Pipeline.run()` calls `open()` before the executor (fails fast) and `close()` in a `finally`.
- **`MockChatClient`**: offline dry-runs without the openai SDK.
- **Reuse one client object** across nodes — the framework dedups loaded weights by object identity. Declare each model once as a top-level singleton.
- ⚠️ If a fn calls `client.chat(...)` directly via closure (instead of via `LLMCall(client=...)`), `Pipeline.run()`'s lifecycle walker won't auto-`open()` it. Harmless for remote clients (no-op open/close); for local HF/vLLM you must `open()/close()` it yourself around `Pipeline.run()`.

## Two ways to call an LLM in a Processor

1. **`LLMCall` (structured, the common case):** one row in → one LLM call → row with an extra field.
   ```python
   Processor(
       LLMCall(prompt="Rewrite vividly: {text}", client=remote,
               output_field="text", temperature=0.7, max_tokens=256),
       input_schema=schema, output_schema=schema, intra_batch_workers=8)
   ```
   `{field}` placeholders in `prompt` are filled from the row. Extra gen kwargs are forwarded to the API.
2. **Hand-written fn calling `client.chat(...)`:** when you need multimodal input, JSON parsing, multi-field output, or conditional logic. See `examples/pipeline.py` for the canonical image-QA pattern (encode image → `chat(messages=[...])` → `json.loads` → return dict / `None` on failure).

## Concurrency

- `intra_batch_workers=N` runs the per-sample fn concurrently within a batch — set it >1 (e.g. 8) for LLM-call nodes, leave at 1 for cheap CPU fns.
- Nodes stream batches to each other through bounded queues (backpressure). One worker thread per node.

## Canonical examples to imitate

- `examples/basic_pipeline.py` — vote + branch + convergence, no real network.
- `examples/pipeline.py` — WebUI-generated then hand-completed; image→QA with a hand-written fn and a Judge filter. **This is the exact shape of a completed fill-in-the-blanks script.**
- `examples/vllm_pipeline.py` — end-to-end local vLLM.
- README quick start (lines 46–96) — two nested branches.

## Common mistakes (avoid these)

- Wiring `judge >> x` instead of `judge.on_true >> x` / `judge.on_false >> x`.
- A Processor fn returning a dict whose keys don't match `output_schema`.
- Forgetting that returning `None` drops the row (and that this is the intended filter idiom).
- Creating a new client object per node instead of sharing one (reloads weights).
- Inventing constructor kwargs. Stick to the signatures above.
- Mismatched schemas at a convergence point.

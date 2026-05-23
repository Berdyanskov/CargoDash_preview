---
name: cargodash-from-scratch
description: Build a complete, runnable CargoDash pipeline script from a natural-language description of a data synthesis / augmentation task. Use when the user describes what they want a pipeline to do ("read this jsonl, augment each row with an LLM, filter low-quality samples, write out") and there is no existing graph or scaffold to complete. Produces a single pipeline.py wired with CargoDash primitives.
---

# Build a CargoDash pipeline from a description

The user describes a data-processing task in words; you produce a complete, runnable `pipeline.py` using CargoDash primitives. There is no pre-built graph here — you design the DAG and write every node. (If the user already scaffolded a graph in the WebUI and only left function bodies blank, use `cargodash-fill-pipeline` instead.)

**First, read `cargodash-reference` (the shared API + semantics skill).** It is the source of truth for signatures, the five function contracts, wiring rules, schema rules, client selection, and the gotchas. Everything below builds on it — do not write code from memory of the API.

## Step 1 — Pin down the spec

From the description, determine (and ask the user only about what you genuinely can't infer):

- **Input**: file path and format (CargoDash reads jsonl), and the columns each row has → the source `Schema`.
- **Output**: file path and the columns to write → the sink `Schema`.
- **Transformations**: each processing step — what it reads, what it produces, whether it calls an LLM.
- **Branching / filtering**: any "keep only…", "drop if…", "route X vs Y" → `Judge` nodes; multi-model agreement → `Vote`.
- **Model access**: which model(s), and deployment kind — remote API (need `model`/`api_key`/`base_url`), local HF, or local vLLM. If the user has no model yet or wants an offline dry-run, use `MockChatClient`.

If a detail is missing and changes the structure (e.g. is there a filtering step? remote or local model?), ask with `AskUserQuestion`. Otherwise pick a sensible default and state it.

## Step 2 — Design the DAG on paper first

Sketch the node graph before writing code:

- A linear chain of `Processor`s for sequential transforms; insert a `Judge` wherever the flow forks.
- Decide each node's `input_schema → output_schema`. Track how columns are added/changed down the chain.
- Decide convergence points: branches that should rejoin must feed the **same** node object and carry **consistent schemas** (see reference). Normalize columns before they converge.
- Decide which steps need concurrency (`intra_batch_workers > 1` for LLM-call nodes).
- Decide how many distinct model clients you need — declare each **once** as a top-level singleton and share it.

State the design back to the user in 2–4 lines (source → steps → sink, with the branch points) before or alongside producing the file.

## Step 3 — Generate `pipeline.py` in the canonical section layout

Match the structure of `examples/pipeline.py` so the output is familiar and WebUI-import-friendly. Emit sections in this order:

```python
# 1. imports — only what's used
from cargodash import (
    Schema, RawDataSource, DataOutput, Processor, Judge, Vote, LLMCall, Pipeline,
    OpenAICompatChatClient,   # or LocalHF/LocalVLLM/MockChatClient as needed
)

# 2. model singletons  (--- model singletons ---)
remote = OpenAICompatChatClient(model="...", api_key="...", base_url="...")

# 3. helpers            (--- helpers ---)  e.g. image encoding, json parsing

# 4. user functions     (--- user functions ---)  top-level def blocks:
#    Processor fns, Judge predicates, Vote model fns

# 5. schemas            (--- schemas ---)  dedupe identical schemas into one var
schema_1 = Schema.of(...)

# 6. nodes              (--- nodes ---)  ctors in topological order
source = RawDataSource("in.jsonl", schema=schema_1, batch_size=32)
...

# 7. edges              (--- edges ---)  >> wiring, on_true/on_false ports
source >> clean >> judge
judge.on_true >> ... >> sink
judge.on_false >> ...

# 8. entrypoint
if __name__ == "__main__":
    Pipeline(source).run()
```

Writing the function bodies — honor the contracts from the reference exactly:

- Processor `fn(row)` returns dict / list[dict] / `None` (None drops the row); output keys must equal `output_schema`.
- Judge `predicate(row)` returns bool; `True`→`on_true`, `False`→`on_false`.
- Vote models return bool; passes at `true_num` Trues.
- For LLM steps, prefer `LLMCall(prompt="... {field} ...", client=remote, output_field=...)` for the simple "one row → one call → extra field" case; write a hand fn calling `client.chat(...)` only when you need multimodal input, JSON parsing, or multi-field output (mirror the defensive `json.loads` + `return None`/`False`-on-failure pattern from `examples/pipeline.py`).
- Reuse the one client object everywhere; never construct a client per node.

## Step 4 — Verify

```bash
python -c "import ast; ast.parse(open('pipeline.py').read())"   # syntax
```

- Re-check against the reference's "common mistakes": every Judge branch goes through a port, output dicts match schemas, convergence schemas agree, no invented kwargs, one shared client.
- Offer a safe smoke test before any live run: swap in `MockChatClient`, or run a capped subset with `Pipeline(source).run(dry_run_rows=N)` (DataOutputs are redirected during a dry run). Confirm with the user before any run that makes real API / local-model calls.
- Tell the user what to install if needed (`pip install openai` for remote, the matching extra for local clients, plus any helper deps like Pillow).

## Boundaries

- Produce a single runnable `pipeline.py` unless the user asks otherwise; don't scatter logic across modules.
- Don't fabricate API surface — if the task needs something CargoDash doesn't have (per the reference and README roadmap, e.g. parquet/csv I/O, retry/resume), say so and propose the closest supported approach rather than inventing it.
- Keep secrets (API keys) as obvious placeholders unless the user provides real ones.

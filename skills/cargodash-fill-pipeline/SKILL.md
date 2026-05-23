---
name: cargodash-fill-pipeline
description: Complete the empty processing methods in a CargoDash pipeline that a user scaffolded in the WebUI. Use when the user has a .cdgraph.json or an exported pipeline.py whose graph (nodes, edges, schemas) is built but the Processor / Judge / Vote function bodies are blank stubs, and asks you to fill them in. Handles both the .cdgraph.json source-of-truth and the generated pipeline.py.
---

# Fill in a WebUI-scaffolded CargoDash pipeline

The user has already built the pipeline *structure* in the CargoDash WebUI — nodes, edges, schemas, model specs — and left the per-node **processing logic blank**. Your job is to fill only those function bodies, honoring the graph and schemas exactly as given. You are NOT redesigning the pipeline.

**First, read `cargodash-reference` (the shared API + semantics skill).** It defines every function contract, the wiring rules, schema rules, and the gotchas. Everything below assumes it.

## Step 1 — Identify the target file and the user's intent

Two possible inputs (support both):

- **`*.cdgraph.json`** — the WebUI source of truth (`GraphProject`, `version: 1`). Editing this preserves WebUI round-trip editing. The blank logic lives in string fields: `Processor.data.fnSource`, `Judge.data.predicate.fnSource`, `Vote.data.models[*].fnSource`.
- **`pipeline.py`** — a one-way export. Editing it is natural and immediately runnable, but ⚠️ **re-exporting from the WebUI overwrites it** (the file header says so). Blank logic lives in the `# --- user functions ---` section as top-level `def` blocks.

**Default rule:** if the user points at a `.cdgraph.json`, edit that. If they point at a `pipeline.py`, edit that. If both exist and it's ambiguous, prefer `.cdgraph.json` (preserves round-trip) and tell the user you can also patch `pipeline.py` directly. Confirm before touching `pipeline.py` if a sibling `.cdgraph.json` exists, since your edits to `.py` won't survive a re-export.

Also read the task description: the user usually states what each node should *do* ("this processor should translate to English", "this judge keeps only Chinese rows"). If intent for a node is unstated, infer it from the node's `varName`, its prompt-ish fields, its input/output schemas, and its position in the DAG — then state your assumption.

## Step 2 — Recognize the blank stubs

WebUI default stubs (these mean "not yet filled" — replace them):

- Processor: `def my_fn(row):\n    ...\n    return row` (returns row unchanged)
- Judge: `def predicate(row):\n    return True`
- Vote model: `def model_a(sample):\n    return True`

Also treat as blank: bodies that are only `pass`, `...`, `return None`/`return True` with no logic, or a `# TODO`/`# fill me in` comment. **Do not touch** functions that already contain real logic — only complete the empty ones unless the user says otherwise.

For LLM-mode Processors (`llmMode: true` in `.cdgraph.json`), there is no fn to write — the logic is the `llmPrompt` / `llmOutputField` / `llmGenKwargs` fields plus a ModelSpec reference. If those are placeholder defaults (`"Rewrite this sentence: {text}"`, empty `modelNodeId`), fill the prompt and ensure a ModelSpec is referenced.

## Step 3 — Build the contract for each blank node

For every node you fill, pin down before writing code:

1. **Signature** — from node kind + mode/granularity (see reference: sample vs batch, predicate, vote model).
2. **Input keys** — exactly the fields in `input_schema`.
3. **Output keys** — for a Processor, exactly the fields in `output_schema`. A Judge/Vote returns `bool` and must not mutate the row's schema.
4. **Filtering** — does this node drop rows? A Processor drops via `return None`; a Judge routes `False` to `.on_false`.
5. **Model access** — if the node needs an LLM, which client/ModelSpec is in scope? Reuse the existing top-level singleton variable (don't create a new client). If a fn calls `client.chat()` directly, remember local clients need manual `open()/close()` (see reference).

## Step 4 — Write the bodies

- Match the surrounding code's style and the canonical `examples/pipeline.py` (JSON-mode chat, defensive parsing, `return None` on failure for Processors / `return False` for Judges).
- Keep output dict keys aligned with `output_schema`. Verify convergence-point schema consistency isn't broken.
- For `.cdgraph.json`: replace the whole `fnSource` string. It MUST contain a top-level `def <name>(...)` block; keep `fnName` in sync with the def name (codegen extracts the name via regex, but keep them consistent). Escape newlines as the JSON requires (`\n`).
- For `pipeline.py`: replace the `def` body in place in the `# --- user functions ---` section. Don't renumber/rename nodes or touch the `# --- nodes ---` / `# --- edges ---` sections.
- Add brief docstrings stating the contract, like the examples do.

## Step 5 — Verify

- **If you edited `.cdgraph.json`**, you can regenerate `pipeline.py` from the WebUI; you cannot run codegen from here, so instead do a careful read-through: every blank is filled, every `fnSource` is valid Python with a matching `def`, no JSON syntax broken (`python -c "import json,sys; json.load(open(...))"`).
- **If you edited `pipeline.py`**, sanity-check it compiles and the graph is sound:
  ```bash
  python -c "import ast; ast.parse(open('pipeline.py').read())"
  ```
  Offer a dry run that avoids hitting real models when possible:
  ```bash
  python pipeline.py            # runs the pipeline as wired
  ```
  If the script uses real API/local-model clients, suggest the user swap in `MockChatClient` or use `Pipeline(...).run(dry_run_rows=N)` for a small smoke test first, and confirm before any run that makes live network/model calls.
- Report which nodes you filled, the contract you assumed for each, and any node whose intent you had to guess.

## Boundaries

- Don't add, remove, or rewire nodes; don't change schemas. If the structure looks wrong for the stated goal, surface it to the user rather than silently restructuring.
- Don't invent constructor kwargs or client config — use what's already declared in the graph.
- Treat `pipeline.py` as disposable relative to `.cdgraph.json`: if both exist, the JSON is the truth source.

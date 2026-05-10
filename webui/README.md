# CargoDash WebUI (preview)

Visual graph editor for CargoDash pipelines. Pure frontend, single-direction
codegen: design the DAG on a canvas, export `pipeline.py`, run it with the
`cargodash` Python package.

## Stack

- Vite + React 18 + TypeScript
- React Flow (canvas)
- Monaco Editor (user function bodies)
- Zustand (graph state)
- Tailwind (styling)

## Quick start

```bash
cd webui
npm install
npm run dev          # http://localhost:5173
```

## Build

```bash
npm run build
npm run preview
```

## How it works

1. Drag nodes from the left palette onto the canvas.
2. Connect nodes with `>>`-style edges. `Judge` exposes two source
   handles (`on_true` / `on_false`); pick the one you want to drag from.
3. Edit each node's parameters in the right panel. `Processor.fn`,
   `Judge.predicate(code)`, and each `Vote.model_list[*]` are written
   directly in Monaco — the function name in your `def` block is the
   one used in the generated file.
4. Export:
   - **pipeline.py** — runnable Python (single-direction codegen).
   - **.cdgraph.json** — full graph state (this is the source of truth;
     reload it later to keep editing).

`Vote` nodes do not connect on the canvas. They are referenced from a
`Judge` node's "predicate source = voteRef" dropdown and inlined into the
generated `Judge(Vote(...), ...)` call.

## Smoke test

The `scripts/smoke_codegen.ts` driver constructs a graph equivalent to
`examples/basic_pipeline.py` from the package, generates Python, and prints
it. Use `--write` to dump it to `scripts/pipeline.smoke.py`:

```bash
npx tsx scripts/smoke_codegen.ts --write
python -c "exec(open('scripts/pipeline.smoke.py').read())"   # builds Pipeline
```

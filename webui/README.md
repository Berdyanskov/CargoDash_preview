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

## Remote server access (SSH port forwarding)

If you run `npm run dev` on a remote machine (e.g. a GPU node you SSH'd
into), `http://localhost:5173` on your laptop won't reach it — clusters
typically block inbound ports even though Vite already binds to all
interfaces (`server.host: true` in `vite.config.ts`). Use SSH local port
forwarding to bridge the two:

On **your laptop**:

```bash
ssh -L 5173:127.0.0.1:5173 <user>@<remote-host>
```

Keep that session open, run `npm run dev` inside it, then open
`http://localhost:5173` in your laptop browser — the tunnel forwards
each request to the remote dev server.

- VS Code Remote / Cursor / JetBrains Gateway forward dev-server ports
  automatically; check the "Ports" panel, no manual `-L` needed.
- If you go through a jump host, add `-J <user>@<jump-host>` or set
  `ProxyJump` in `~/.ssh/config`.
- If `5173` is taken locally, change the local side:
  `ssh -L 5174:127.0.0.1:5173 ...` and open `http://localhost:5174`.

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

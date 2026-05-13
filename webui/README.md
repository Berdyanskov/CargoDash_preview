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

## Remote server access

When `npm run dev` runs on a remote machine you reach via your editor's
port-forwarding feature, you'll hit the server through one of two URL
shapes depending on the editor / tunnel:

1. **Root subdomain**, e.g. `https://xxx-5173.<region>.devtunnels.ms/` —
   VS Code Tunnels / Cursor. The forwarded port is on its own subdomain;
   the app lives at the root path.
2. **Subpath proxy**, e.g. `https://<host>/<...>/proxy/5173/` —
   `code-server` and similar in-browser VS Code variants, JupyterHub
   gateways, etc. The app is mounted under a path prefix.

For case 1, plain `npm run dev` works. **For case 2, use `npm run build
&& npm run preview` instead** — `dev` is fundamentally fragile under a
subpath proxy because Vite injects internal absolute-path scripts
(`/@vite/client`, `/@react-refresh`, sometimes the entry script too)
that bypass the `base` config and 404 through the proxy. The **built**
output uses only `base: './'`-respecting relative URLs, no internals,
and `vite preview` is a plain static server that works happily under
any path prefix.

```bash
# on the remote machine
cd webui
npm run build     # writes dist/
npm run preview   # serves dist/ on 0.0.0.0:5173
```

The `preview` block in `vite.config.ts` mirrors `server` (port 5173,
host: true, allowedHosts: true), so the same proxy URL you tried for
`dev` works for `preview` without changes.

Tradeoff: no HMR — you must rerun `npm run build` after editing the
WebUI source. For the typical "use the WebUI as a graph editor" remote
case that's fine.

If you need HMR remotely, you'd have to either use case 1 (root
subdomain tunnel) and `npm run dev`, or set `server.hmr` to match your
specific proxy URL.

If the cluster permits SSH, classic SSH local port forwarding is also a
fallback:

```bash
# on your laptop
ssh -L 5173:127.0.0.1:5173 <user>@<remote-host>
```

then open `http://localhost:5173` in your laptop browser.

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

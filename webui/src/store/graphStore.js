import { create } from "zustand";
import { applyEdgeChanges, applyNodeChanges, addEdge, } from "reactflow";
import { defaultNodeData } from "../nodes/defaults";
/** Bring old .cdgraph.json node data forward to the current schema.
 * Per-node, three transforms can fire:
 *
 *  1. LLMCall node → Processor node with ``llmMode: true``. Keeps the
 *     same id / position so edges still resolve.
 *  2. Old Processor data (pre-LLM-merge) lacks the ``llm*`` fields and
 *     ``llmMode`` flag. We backfill with defaults; ``llmMode`` defaults
 *     to ``false`` so the existing fn-driven Processors keep working.
 *  3. Inline ``llmClient`` (``{mode:"inline", model, apiKey, baseUrl}``)
 *     is rewritten in the project-level migration (``migrateProject``)
 *     since it needs to *spawn a new ModelSpec node* — not something a
 *     per-node transform can do alone.
 *
 * The returned type may temporarily carry the legacy inline ``llmClient``
 * shape until ``migrateProject`` resolves it. Treat ``migrateNodeData``
 * output as intermediate; ``migrateProject`` is the canonical entry point.
 */
export function migrateNodeData(raw) {
    const d = raw;
    if (d.kind === "LLMCall") {
        // Old shape:
        //   { kind: "LLMCall", prompt, outputField, client, genKwargs,
        //     intraBatchWorkers, inputSchema, outputSchema, varName }
        const out = {
            kind: "Processor",
            varName: String(d.varName ?? ""),
            llmMode: true,
            // Code-mode defaults — never read because llmMode is true, but the
            // type demands they exist.
            mode: "sample",
            fnSource: "def my_fn(row):\n    return row\n",
            fnName: "my_fn",
            llmPrompt: String(d.prompt ?? ""),
            llmOutputField: String(d.outputField ?? "llm_output"),
            // d.client may be legacy inline ({mode:"inline", model, apiKey,
            // baseUrl}); the type only allows modelRef now. We use a double
            // cast so migrateProject can see and rewrite it.
            llmClient: d.client,
            llmGenKwargs: String(d.genKwargs ?? "{}"),
            intraBatchWorkers: Number(d.intraBatchWorkers ?? 4),
            inputSchema: d.inputSchema ?? [],
            outputSchema: d.outputSchema ?? [],
        };
        return out;
    }
    if (d.kind === "Processor" && d.llmMode === undefined) {
        // Backfill new llm* fields on a pre-merge Processor. Use modelRef
        // with empty id as the placeholder — codegen will tell the user to
        // pick one if they ever flip llmMode on without configuring it.
        const out = {
            ...d,
            llmMode: false,
            llmPrompt: "Rewrite this sentence: {text}",
            llmOutputField: "text",
            llmClient: { mode: "modelRef", modelNodeId: "" },
            llmGenKwargs: "{}",
        };
        return out;
    }
    return raw;
}
/** Default field set for a brand-new remote-kind ModelSpec. Used by
 * the inline → ModelSpec migration; kept in sync with ``defaultNodeData``
 * for ModelSpec, except the model identification fields come from the
 * legacy inline client. */
function remoteModelSpecFrom(varName, model, apiKey, baseUrl) {
    return {
        kind: "ModelSpec",
        varName,
        modelKind: "remote",
        model,
        apiKey,
        baseUrl,
        cacheDir: "",
        trustRemoteCode: false,
        dtype: "",
        servedModelName: "",
        tensorParallelSize: 1,
        gpuMemoryUtilization: 0.9,
        maxModelLen: 0,
        extraArgs: "",
        startupTimeout: 600,
        logPath: "",
        device: "cuda",
        maxNewTokens: 512,
    };
}
/** Project-level migration. Runs ``migrateNodeData`` per node first,
 * then expands every inline-client LLM-mode Processor into a
 * (Processor + sibling ModelSpec) pair. Inline was strictly equivalent
 * to a remote-kind ModelSpec — we just make it explicit so all model
 * declarations live in first-class nodes. No-op when there's nothing
 * to migrate. */
export function migrateProject(project) {
    let nodes = project.nodes.map((n) => ({
        id: n.id,
        position: n.position,
        data: migrateNodeData(n.data),
    }));
    // Compute fresh-id counter from the *_<n> suffix of existing ids,
    // so the spawned ModelSpec ids never collide with anything in the file.
    let counter = Math.max(0, ...nodes.map((n) => {
        const m = n.id.match(/_(\d+)$/);
        return m ? parseInt(m[1], 10) : 0;
    }));
    const extras = [];
    nodes = nodes.map((n) => {
        if (n.data.kind !== "Processor" || !n.data.llmMode)
            return n;
        const legacyClient = n.data.llmClient;
        if (legacyClient.mode !== "inline")
            return n;
        counter += 1;
        const newId = `ModelSpec_${counter}`;
        extras.push({
            id: newId,
            position: { x: n.position.x - 240, y: n.position.y - 80 },
            data: remoteModelSpecFrom(`${n.data.varName}_model`, String(legacyClient.model ?? ""), String(legacyClient.apiKey ?? ""), String(legacyClient.baseUrl ?? "")),
        });
        const fixed = {
            ...n.data,
            llmClient: { mode: "modelRef", modelNodeId: newId },
        };
        return { ...n, data: fixed };
    });
    return { ...project, nodes: [...nodes, ...extras] };
}
let nodeCounter = 0;
const nextNodeId = (kind) => `${kind}_${++nodeCounter}`;
export const useGraphStore = create((set, get) => ({
    nodes: [],
    edges: [],
    selectedId: null,
    onNodesChange: (changes) => set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) })),
    onEdgesChange: (changes) => set((s) => ({ edges: applyEdgeChanges(changes, s.edges) })),
    onConnect: (conn) => set((s) => {
        // sourceHandle drives Judge.on_true / on_false. Default is "default".
        const port = conn.sourceHandle === "true" || conn.sourceHandle === "false"
            ? conn.sourceHandle
            : "default";
        return {
            edges: addEdge({ ...conn, sourceHandle: port, type: "smoothstep" }, s.edges),
        };
    }),
    addNode: (kind, position) => set((s) => {
        const id = nextNodeId(kind);
        const data = defaultNodeData(kind, id);
        const node = { id, type: kind, position, data };
        return { nodes: [...s.nodes, node], selectedId: id };
    }),
    createNode: (kind, position) => {
        const id = nextNodeId(kind);
        const data = defaultNodeData(kind, id);
        set((s) => ({
            nodes: [...s.nodes, { id, type: kind, position, data }],
        }));
        return id;
    },
    updateNodeData: (id, patch) => set((s) => ({
        nodes: s.nodes.map((n) => n.id === id
            ? { ...n, data: { ...n.data, ...patch } }
            : n),
    })),
    deleteNode: (id) => set((s) => ({
        nodes: s.nodes.filter((n) => n.id !== id),
        edges: s.edges.filter((e) => e.source !== id && e.target !== id),
        selectedId: s.selectedId === id ? null : s.selectedId,
    })),
    selectNode: (id) => set({ selectedId: id }),
    loadProject: (project) => {
        if (project.version !== 1) {
            throw new Error(`unsupported project version: ${project.version}`);
        }
        const migrated = migrateProject(project);
        nodeCounter = Math.max(nodeCounter, ...migrated.nodes.map((n) => parseInt(n.id.split("_").pop() ?? "0", 10)));
        set({
            nodes: migrated.nodes.map((n) => ({
                id: n.id,
                position: n.position,
                type: n.data.kind,
                data: n.data,
            })),
            edges: migrated.edges.map((e) => ({
                id: e.id,
                source: e.source,
                target: e.target,
                sourceHandle: e.sourceHandle,
                type: "smoothstep",
            })),
            selectedId: null,
        });
    },
    toProject: () => {
        const { nodes, edges } = get();
        return {
            version: 1,
            nodes: nodes.map((n) => ({
                id: n.id,
                position: n.position,
                data: n.data,
            })),
            edges: edges.map((e) => ({
                id: e.id,
                source: e.source,
                target: e.target,
                sourceHandle: e.sourceHandle ?? "default",
            })),
        };
    },
    reset: () => set({ nodes: [], edges: [], selectedId: null }),
}));

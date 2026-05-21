// Graph -> Python codegen.
//
// Strategy:
//   1. validate (>= 1 source, no isolated nodes, identifiers, vote refs)
//   2. emit user fn defs (Processor.fn, Judge.predicate(code), Vote.models[*])
//   3. emit deduped Schema.of(...) literals
//   4. emit node ctors in topological order
//   5. emit `>>` edges using sourceHandle for Judge ports
//   6. emit `if __name__ == "__main__": Pipeline(source_or_sources).run([dry_run_rows=N])`
//
// Vote nodes do not appear on the canvas as connected nodes. They are
// instantiated where needed and passed into Judge(...).
export class CodegenError extends Error {
}
const PY_TYPE = {
    int: "int",
    float: "float",
    str: "str",
    bool: "bool",
};
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
function checkIdent(name, label) {
    if (!IDENT_RE.test(name)) {
        throw new CodegenError(`${label} "${name}" is not a valid Python identifier`);
    }
}
function pyStr(s) {
    // Always emit a double-quoted string with backslash escaping.
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}
function pyBool(b) {
    return b ? "True" : "False";
}
function schemaCall(fields) {
    if (fields.length === 0) {
        return "Schema.of()";
    }
    const args = fields.map((f) => {
        checkIdent(f.name, "schema field");
        return `${f.name}=${PY_TYPE[f.type]}`;
    });
    return `Schema.of(${args.join(", ")})`;
}
function schemaKey(fields) {
    return fields.map((f) => `${f.name}:${f.type}`).join(",");
}
function newSchemaPool() {
    return { byKey: new Map(), defs: [] };
}
function getSchemaVar(pool, fields) {
    const key = schemaKey(fields);
    const cached = pool.byKey.get(key);
    if (cached)
        return cached;
    const name = `schema_${pool.byKey.size + 1}`;
    pool.byKey.set(key, name);
    pool.defs.push(`${name} = ${schemaCall(fields)}`);
    return name;
}
function buildAdjacency(project) {
    const fwd = new Map();
    const inDeg = new Map();
    for (const n of project.nodes) {
        fwd.set(n.id, []);
        inDeg.set(n.id, 0);
    }
    for (const e of project.edges) {
        if (!fwd.has(e.source) || !inDeg.has(e.target))
            continue;
        fwd.get(e.source).push({ target: e.target, port: e.sourceHandle });
        inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
    }
    return { fwd, inDeg };
}
function topoSort(project, floatIds) {
    // Skip "floating" nodes (Vote, ModelSpec) — referenced, not connected.
    const live = project.nodes.filter((n) => !floatIds.has(n.id));
    const liveIds = new Set(live.map((n) => n.id));
    const fwd = new Map();
    const inDeg = new Map();
    for (const n of live) {
        fwd.set(n.id, []);
        inDeg.set(n.id, 0);
    }
    for (const e of project.edges) {
        if (!liveIds.has(e.source) || !liveIds.has(e.target))
            continue;
        fwd.get(e.source).push(e.target);
        inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
    }
    const queue = [];
    for (const [id, d] of inDeg)
        if (d === 0)
            queue.push(id);
    const ordered = [];
    while (queue.length) {
        const id = queue.shift();
        ordered.push(id);
        for (const t of fwd.get(id)) {
            const nd = (inDeg.get(t) ?? 0) - 1;
            inDeg.set(t, nd);
            if (nd === 0)
                queue.push(t);
        }
    }
    if (ordered.length !== live.length) {
        throw new CodegenError("graph has a cycle — Pipeline must be a DAG");
    }
    return ordered;
}
function findSources(project) {
    const sources = project.nodes.filter((n) => n.data.kind === "RawDataSource");
    if (sources.length === 0) {
        throw new CodegenError("no RawDataSource node in the graph");
    }
    return sources.map((n) => n.id);
}
function ensureUniqueVarNames(nodes) {
    const used = new Set();
    const out = new Map();
    for (const n of nodes) {
        let base = n.data.varName.trim() || n.id.toLowerCase();
        if (!IDENT_RE.test(base)) {
            throw new CodegenError(`variable name "${n.data.varName}" on node ${n.id} is not a valid Python identifier`);
        }
        let final = base;
        let i = 2;
        while (used.has(final))
            final = `${base}_${i++}`;
        used.add(final);
        out.set(n.id, final);
    }
    return out;
}
function extractFnName(source, fallback) {
    const m = source.match(/^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/m);
    return m ? m[1] : fallback;
}
function trimmedSource(src) {
    return src.replace(/\s+$/g, "") + "\n";
}
function emitVoteCtor(data, fnNamesByVoteId, voteId) {
    const names = fnNamesByVoteId.get(voteId) ?? [];
    return `Vote(model_list=[${names.join(", ")}], true_num=${data.trueNum})`;
}
/** Emit a ``LLMCall(prompt=..., client=<modelspec_var>, ...)`` Python
 * literal for an LLM-mode Processor. The client is always resolved
 * from a ModelSpec node — inline (model+api_key inlined on the
 * Processor) was removed; all model declarations are first-class
 * nodes. */
function emitLLMCallCtor(d, varName, modelVarByNodeId) {
    const llmArgs = [
        `prompt=${pyStr(d.llmPrompt)}`,
        `output_field=${pyStr(d.llmOutputField)}`,
    ];
    const modelVar = modelVarByNodeId.get(d.llmClient.modelNodeId);
    if (!modelVar) {
        throw new CodegenError(`Processor "${varName}" (LLM mode) needs a ModelSpec node — pick ` +
            `one in the "model spec" dropdown (or drop a ModelSpec on the canvas first)`);
    }
    llmArgs.push(`client=${modelVar}`);
    const raw = d.llmGenKwargs.trim();
    if (raw && raw !== "{}") {
        let parsedKwargs;
        try {
            parsedKwargs = JSON.parse(raw);
        }
        catch {
            throw new CodegenError(`Processor ${varName} (LLM mode): gen_kwargs must be valid JSON`);
        }
        if (typeof parsedKwargs !== "object" || Array.isArray(parsedKwargs)) {
            throw new CodegenError(`Processor ${varName} (LLM mode): gen_kwargs must be a JSON object`);
        }
        for (const [k, v] of Object.entries(parsedKwargs)) {
            checkIdent(k, "gen_kwargs key");
            llmArgs.push(`${k}=${jsonValueToPy(v)}`);
        }
    }
    return `LLMCall(${llmArgs.join(", ")})`;
}
function emitNodeCtor(id, data, varName, schemas, fnNamesByNode, voteCtorByJudgeId, modelVarByNodeId) {
    switch (data.kind) {
        case "RawDataSource": {
            const d = data;
            const sch = getSchemaVar(schemas, d.schema);
            return `${varName} = RawDataSource(${pyStr(d.path)}, schema=${sch}, batch_size=${d.batchSize})`;
        }
        case "DataOutput": {
            const d = data;
            const sch = getSchemaVar(schemas, d.schema);
            return `${varName} = DataOutput(${pyStr(d.path)}, schema=${sch}, preserve_order=${pyBool(d.preserveOrder)})`;
        }
        case "Processor": {
            const d = data;
            const inSch = getSchemaVar(schemas, d.inputSchema);
            const outSch = getSchemaVar(schemas, d.outputSchema);
            if (d.llmMode) {
                // LLM-mode Processor: fn is `LLMCall(...)`, no user-authored fn
                // def is emitted (LLMCall replaces it). Sample mode is implied
                // — LLMCall always processes per-row.
                const llmCtor = emitLLMCallCtor(d, varName, modelVarByNodeId);
                const procArgs = [
                    llmCtor,
                    `input_schema=${inSch}`,
                    `output_schema=${outSch}`,
                    `intra_batch_workers=${d.intraBatchWorkers}`,
                ];
                return `${varName} = Processor(${procArgs.join(", ")})`;
            }
            const fn = fnNamesByNode.get(id);
            const args = [
                fn,
                `mode=${pyStr(d.mode)}`,
                `input_schema=${inSch}`,
                `output_schema=${outSch}`,
                `intra_batch_workers=${d.intraBatchWorkers}`,
            ];
            return `${varName} = Processor(${args.join(", ")})`;
        }
        case "Judge": {
            const d = data;
            const inSch = getSchemaVar(schemas, d.inputSchema);
            const predicate = d.predicate.mode === "code"
                ? fnNamesByNode.get(id)
                : voteCtorByJudgeId.get(id);
            const args = [
                predicate,
                `granularity=${pyStr(d.granularity)}`,
                `input_schema=${inSch}`,
                `intra_batch_workers=${d.intraBatchWorkers}`,
            ];
            return `${varName} = Judge(${args.join(", ")})`;
        }
        case "Vote":
            // Should not be called: Vote nodes are inlined at Judge ctor time.
            throw new CodegenError(`internal: tried to emit Vote node ${varName} as a graph node`);
        case "ModelSpec":
            // Should not be called: ModelSpec nodes are emitted as top-level
            // singletons, not as runtime graph nodes.
            throw new CodegenError(`internal: tried to emit ModelSpec node ${varName} as a graph node`);
    }
}
function emitModelSpec(data, varName) {
    switch (data.modelKind) {
        case "remote": {
            const args = [
                `model=${pyStr(data.model)}`,
                `api_key=${pyStr(data.apiKey)}`,
            ];
            if (data.baseUrl.trim()) {
                args.push(`base_url=${pyStr(data.baseUrl)}`);
            }
            return {
                decl: `${varName} = OpenAICompatChatClient(${args.join(", ")})`,
                importName: "OpenAICompatChatClient",
            };
        }
        case "local_hf": {
            const args = [pyStr(data.model)];
            if (data.device.trim())
                args.push(`device=${pyStr(data.device)}`);
            if (data.dtype.trim())
                args.push(`dtype=${pyStr(data.dtype)}`);
            if (data.cacheDir.trim())
                args.push(`cache_dir=${pyStr(data.cacheDir)}`);
            if (data.trustRemoteCode)
                args.push(`trust_remote_code=True`);
            if (data.maxNewTokens && data.maxNewTokens !== 512) {
                args.push(`max_new_tokens=${data.maxNewTokens}`);
            }
            return {
                decl: `${varName} = LocalHFChatClient(${args.join(", ")})`,
                importName: "LocalHFChatClient",
            };
        }
        case "local_vllm": {
            const args = [pyStr(data.model)];
            if (data.servedModelName.trim()) {
                args.push(`served_model_name=${pyStr(data.servedModelName)}`);
            }
            if (data.dtype.trim())
                args.push(`dtype=${pyStr(data.dtype)}`);
            if (data.tensorParallelSize && data.tensorParallelSize !== 1) {
                args.push(`tensor_parallel_size=${data.tensorParallelSize}`);
            }
            if (typeof data.gpuMemoryUtilization === "number" &&
                data.gpuMemoryUtilization !== 0.9) {
                args.push(`gpu_memory_utilization=${data.gpuMemoryUtilization}`);
            }
            if (data.maxModelLen && data.maxModelLen > 0) {
                args.push(`max_model_len=${data.maxModelLen}`);
            }
            if (data.cacheDir.trim()) {
                args.push(`download_dir=${pyStr(data.cacheDir)}`);
            }
            if (data.trustRemoteCode)
                args.push(`trust_remote_code=True`);
            if (data.startupTimeout && data.startupTimeout !== 600) {
                args.push(`startup_timeout=${data.startupTimeout}`);
            }
            if (data.logPath.trim())
                args.push(`log_path=${pyStr(data.logPath)}`);
            if (data.extraArgs.trim()) {
                const tokens = data.extraArgs.split(/\s+/).filter(Boolean);
                args.push(`extra_args=[${tokens.map(pyStr).join(", ")}]`);
            }
            return {
                decl: `${varName} = LocalVLLMChatClient(${args.join(", ")})`,
                importName: "LocalVLLMChatClient",
            };
        }
    }
}
function jsonValueToPy(v) {
    if (v === null)
        return "None";
    if (typeof v === "boolean")
        return pyBool(v);
    if (typeof v === "number")
        return String(v);
    if (typeof v === "string")
        return pyStr(v);
    if (Array.isArray(v)) {
        return `[${v.map(jsonValueToPy).join(", ")}]`;
    }
    if (typeof v === "object") {
        const entries = Object.entries(v).map(([k, val]) => `${pyStr(k)}: ${jsonValueToPy(val)}`);
        return `{${entries.join(", ")}}`;
    }
    throw new CodegenError(`unsupported gen_kwargs value: ${String(v)}`);
}
export function generatePython(project, options = {}) {
    if (project.nodes.length === 0) {
        throw new CodegenError("graph is empty");
    }
    const dryRunRows = options.dryRunRows != null && options.dryRunRows > 0
        ? Math.floor(options.dryRunRows)
        : null;
    // -- index nodes
    const nodeMap = {};
    for (const n of project.nodes)
        nodeMap[n.id] = { id: n.id, data: n.data };
    const voteIds = new Set(project.nodes.filter((n) => n.data.kind === "Vote").map((n) => n.id));
    const modelSpecIds = new Set(project.nodes.filter((n) => n.data.kind === "ModelSpec").map((n) => n.id));
    const floatingIds = new Set([...voteIds, ...modelSpecIds]);
    // -- one or more sources
    const sourceIds = findSources(project);
    const sourceIdSet = new Set(sourceIds);
    // -- topological order over non-floating nodes
    const topo = topoSort(project, floatingIds);
    // -- detect orphans (non-source nodes with no upstream)
    for (const id of topo) {
        if (sourceIdSet.has(id))
            continue;
        const hasUpstream = project.edges.some((e) => e.target === id);
        if (!hasUpstream) {
            throw new CodegenError(`node "${nodeMap[id].data.varName}" has no upstream — it would never receive data`);
        }
    }
    // -- unique varnames
    const varNames = ensureUniqueVarNames(project.nodes);
    // -- collect user fn defs and assign emission order
    const fnDefs = [];
    const fnNamesByNode = new Map(); // node id -> emitted fn ident (for Processor / Judge code)
    const fnNamesByVoteId = new Map(); // vote id -> [fn idents]
    const usedFnNames = new Set();
    const claimFnName = (preferred, fallback) => {
        let base = preferred && IDENT_RE.test(preferred) ? preferred : fallback;
        let final = base;
        let i = 2;
        while (usedFnNames.has(final))
            final = `${base}_${i++}`;
        usedFnNames.add(final);
        return final;
    };
    for (const n of project.nodes) {
        const v = varNames.get(n.id);
        if (n.data.kind === "Processor" && !n.data.llmMode) {
            // LLM-mode Processors don't emit a user fn def — LLMCall is the fn.
            const declared = extractFnName(n.data.fnSource, `${v}_fn`);
            const final = claimFnName(declared, `${v}_fn`);
            fnNamesByNode.set(n.id, final);
            fnDefs.push({ declaredName: declared, source: rewriteFnName(n.data.fnSource, declared, final, `${v}_fn`) });
        }
        else if (n.data.kind === "Judge" && n.data.predicate.mode === "code") {
            const declared = extractFnName(n.data.predicate.fnSource, `${v}_predicate`);
            const final = claimFnName(declared, `${v}_predicate`);
            fnNamesByNode.set(n.id, final);
            fnDefs.push({
                declaredName: declared,
                source: rewriteFnName(n.data.predicate.fnSource, declared, final, `${v}_predicate`),
            });
        }
        else if (n.data.kind === "Vote") {
            const names = [];
            for (let i = 0; i < n.data.models.length; i++) {
                const m = n.data.models[i];
                const declared = extractFnName(m.fnSource, m.fnName || `${v}_model_${i + 1}`);
                const final = claimFnName(declared, `${v}_model_${i + 1}`);
                names.push(final);
                fnDefs.push({
                    declaredName: declared,
                    source: rewriteFnName(m.fnSource, declared, final, `${v}_model_${i + 1}`),
                });
            }
            fnNamesByVoteId.set(n.id, names);
        }
    }
    // -- vote ctors needed by Judge nodes
    const voteCtorByJudgeId = new Map();
    for (const n of project.nodes) {
        if (n.data.kind !== "Judge")
            continue;
        if (n.data.predicate.mode !== "voteRef")
            continue;
        const targetId = n.data.predicate.voteNodeId;
        if (!targetId || !voteIds.has(targetId)) {
            throw new CodegenError(`Judge "${n.data.varName}" references unknown Vote node id ${targetId || "(none)"}`);
        }
        const voteData = nodeMap[targetId].data;
        voteCtorByJudgeId.set(n.id, emitVoteCtor(voteData, fnNamesByVoteId, targetId));
    }
    // -- emit ModelSpec singletons (top-level, shared across all references)
    const modelVarByNodeId = new Map();
    const modelDeclLines = [];
    const extraClientImports = new Set();
    for (const n of project.nodes) {
        if (n.data.kind !== "ModelSpec")
            continue;
        const v = varNames.get(n.id);
        const { decl, importName } = emitModelSpec(n.data, v);
        modelVarByNodeId.set(n.id, v);
        modelDeclLines.push(decl);
        extraClientImports.add(importName);
    }
    // -- emit schemas + node ctors
    const schemas = newSchemaPool();
    const ctorLines = [];
    for (const id of topo) {
        const data = nodeMap[id].data;
        const v = varNames.get(id);
        ctorLines.push(emitNodeCtor(id, data, v, schemas, fnNamesByNode, voteCtorByJudgeId, modelVarByNodeId));
    }
    // -- edges in topo order
    const { fwd } = buildAdjacency(project);
    const edgeLines = [];
    for (const id of topo) {
        const outs = (fwd.get(id) ?? []).filter((e) => !floatingIds.has(e.target));
        for (const e of outs) {
            const lhs = varNames.get(id);
            const rhs = varNames.get(e.target);
            const portExpr = e.port === "true"
                ? `${lhs}.on_true`
                : e.port === "false"
                    ? `${lhs}.on_false`
                    : lhs;
            edgeLines.push(`${portExpr} >> ${rhs}`);
        }
    }
    // -- assemble file
    const sourceVars = sourceIds.map((id) => varNames.get(id));
    const pipelineArg = sourceVars.length === 1 ? sourceVars[0] : `[${sourceVars.join(", ")}]`;
    const out = [];
    out.push("# Auto-generated by CargoDash WebUI. Do not hand-edit; round-trip from .cdgraph.json.");
    out.push("from __future__ import annotations");
    out.push("");
    const baseImports = [
        "Schema",
        "RawDataSource",
        "DataOutput",
        "Processor",
        "Judge",
        "Vote",
        "LLMCall",
        "Pipeline",
    ];
    const allImports = [...baseImports, ...Array.from(extraClientImports).sort()];
    out.push("from cargodash import (");
    const wrapped = wrapImportList(allImports, 4, 76);
    for (const line of wrapped)
        out.push(line);
    out.push(")");
    out.push("");
    // Models first so user fns below can reference the variables by name.
    // Function bodies are lazy-evaluated, so the runtime would actually
    // tolerate either order, but top-to-bottom readability matters and
    // users frequently scroll to their fn and want to see what client
    // variable is in scope.
    if (modelDeclLines.length) {
        out.push("# --- model singletons ------------------------------------------------------");
        for (const line of modelDeclLines)
            out.push(line);
        out.push("");
    }
    if (fnDefs.length) {
        out.push("# --- user functions --------------------------------------------------------");
        for (const f of fnDefs) {
            out.push(trimmedSource(f.source));
        }
    }
    out.push("# --- schemas ---------------------------------------------------------------");
    for (const def of schemas.defs)
        out.push(def);
    out.push("");
    out.push("# --- nodes -----------------------------------------------------------------");
    for (const line of ctorLines)
        out.push(line);
    out.push("");
    out.push("# --- edges -----------------------------------------------------------------");
    for (const line of edgeLines)
        out.push(line);
    out.push("");
    out.push('if __name__ == "__main__":');
    const runArgs = dryRunRows != null ? `dry_run_rows=${dryRunRows}` : "";
    out.push(`    Pipeline(${pipelineArg}).run(${runArgs})`);
    out.push("");
    return out.join("\n");
}
/** Wrap a comma-separated import list to fit within a column budget,
 * indented by ``indent`` spaces. Always emits at least one line. */
function wrapImportList(names, indent, maxWidth) {
    const pad = " ".repeat(indent);
    const lines = [];
    let current = "";
    for (const name of names) {
        const piece = `${name},`;
        if (!current) {
            current = pad + piece;
            continue;
        }
        if (current.length + 1 + piece.length > maxWidth) {
            lines.push(current);
            current = pad + piece;
        }
        else {
            current = `${current} ${piece}`;
        }
    }
    if (current)
        lines.push(current);
    return lines;
}
/** If the user wrote `def foo(...):`, but our final emitted name is `foo_2`,
 * rewrite the def header. We only touch the first `def <name>(` occurrence. */
function rewriteFnName(src, declared, final, fallback) {
    if (declared === final && /^\s*def\s+[A-Za-z_]/m.test(src))
        return src;
    // If the user didn't even write a def, wrap a placeholder.
    if (!/^\s*def\s+[A-Za-z_]/m.test(src)) {
        return `def ${final}(*args, **kwargs):\n    raise NotImplementedError(${pyStr(`fill in body for ${fallback}`)})\n`;
    }
    return src.replace(/^(\s*def\s+)[A-Za-z_][A-Za-z0-9_]*(\s*\()/m, `$1${final}$2`);
}

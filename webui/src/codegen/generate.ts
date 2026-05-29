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

import type {
  AnyNodeData,
  EdgePort,
  GraphProject,
  JudgeData,
  JoinByIdData,
  ModelSpecData,
  ProcessorData,
  RawDataSourceData,
  DataOutputData,
  SchemaField,
  VoteData,
} from "../types/graph";

export class CodegenError extends Error {}

const PY_TYPE: Record<SchemaField["type"], string> = {
  int: "int",
  float: "float",
  str: "str",
  bool: "bool",
};

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function checkIdent(name: string, label: string) {
  if (!IDENT_RE.test(name)) {
    throw new CodegenError(`${label} "${name}" is not a valid Python identifier`);
  }
}

function pyStr(s: string): string {
  // Always emit a double-quoted string with backslash escaping.
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function pyBool(b: boolean): string {
  return b ? "True" : "False";
}

function schemaCall(fields: SchemaField[]): string {
  if (fields.length === 0) {
    return "Schema.of()";
  }
  const args = fields.map((f) => {
    checkIdent(f.name, "schema field");
    return `${f.name}=${PY_TYPE[f.type]}`;
  });
  return `Schema.of(${args.join(", ")})`;
}

function schemaKey(fields: SchemaField[]): string {
  return fields.map((f) => `${f.name}:${f.type}`).join(",");
}

interface SchemaPool {
  // Maps schema content -> emitted variable name.
  byKey: Map<string, string>;
  defs: string[];
}

function newSchemaPool(): SchemaPool {
  return { byKey: new Map(), defs: [] };
}

function getSchemaVar(pool: SchemaPool, fields: SchemaField[]): string {
  const key = schemaKey(fields);
  const cached = pool.byKey.get(key);
  if (cached) return cached;
  const name = `schema_${pool.byKey.size + 1}`;
  pool.byKey.set(key, name);
  pool.defs.push(`${name} = ${schemaCall(fields)}`);
  return name;
}

interface NodeMap {
  [id: string]: { id: string; data: AnyNodeData };
}

interface AdjacencyEntry {
  target: string;
  port: EdgePort;
}

function buildAdjacency(
  project: GraphProject,
): {
  fwd: Map<string, AdjacencyEntry[]>;
  inDeg: Map<string, number>;
} {
  const fwd = new Map<string, AdjacencyEntry[]>();
  const inDeg = new Map<string, number>();
  for (const n of project.nodes) {
    fwd.set(n.id, []);
    inDeg.set(n.id, 0);
  }
  for (const e of project.edges) {
    if (!fwd.has(e.source) || !inDeg.has(e.target)) continue;
    fwd.get(e.source)!.push({ target: e.target, port: e.sourceHandle });
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  }
  return { fwd, inDeg };
}

function topoSort(project: GraphProject, floatIds: Set<string>): string[] {
  // Skip "floating" nodes (Vote, ModelSpec) — referenced, not connected.
  const live = project.nodes.filter((n) => !floatIds.has(n.id));
  const liveIds = new Set(live.map((n) => n.id));
  const fwd = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  for (const n of live) {
    fwd.set(n.id, []);
    inDeg.set(n.id, 0);
  }
  for (const e of project.edges) {
    if (!liveIds.has(e.source) || !liveIds.has(e.target)) continue;
    fwd.get(e.source)!.push(e.target);
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  }
  const queue: string[] = [];
  for (const [id, d] of inDeg) if (d === 0) queue.push(id);
  const ordered: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    ordered.push(id);
    for (const t of fwd.get(id)!) {
      const nd = (inDeg.get(t) ?? 0) - 1;
      inDeg.set(t, nd);
      if (nd === 0) queue.push(t);
    }
  }
  if (ordered.length !== live.length) {
    throw new CodegenError("graph has a cycle — Pipeline must be a DAG");
  }
  return ordered;
}

function findSources(project: GraphProject): string[] {
  const sources = project.nodes.filter(
    (n) => n.data.kind === "RawDataSource",
  );
  if (sources.length === 0) {
    throw new CodegenError("no RawDataSource node in the graph");
  }
  return sources.map((n) => n.id);
}

function ensureUniqueVarNames(nodes: GraphProject["nodes"]): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const n of nodes) {
    let base = n.data.varName.trim() || n.id.toLowerCase();
    if (!IDENT_RE.test(base)) {
      throw new CodegenError(
        `variable name "${n.data.varName}" on node ${n.id} is not a valid Python identifier`,
      );
    }
    let final = base;
    let i = 2;
    while (used.has(final)) final = `${base}_${i++}`;
    used.add(final);
    out.set(n.id, final);
  }
  return out;
}

function extractFnName(source: string, fallback: string): string {
  const m = source.match(/^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/m);
  return m ? m[1] : fallback;
}

interface FnEmit {
  declaredName: string; // what the user wrote (or fallback)
  source: string; // the user's def block (verbatim, trimmed)
}

function trimmedSource(src: string): string {
  return src.replace(/\s+$/g, "") + "\n";
}

function emitVoteCtor(
  data: VoteData,
  fnNamesByVoteId: Map<string, string[]>,
  voteId: string,
): string {
  const names = fnNamesByVoteId.get(voteId) ?? [];
  const args = [`model_list=[${names.join(", ")}]`, `true_num=${data.trueNum}`];
  // prompt_list is positionally aligned with model_list (same order as
  // data.models, which is the order names were collected in). Emit it only
  // when at least one model carries a prompt; per-model None for the rest.
  const prompts = data.models.map((m) => m.prompt?.trim() || null);
  if (prompts.some((p) => p !== null)) {
    const items = prompts.map((p) => (p === null ? "None" : pyStr(p)));
    args.push(`prompt_list=[${items.join(", ")}]`);
  }
  return `Vote(${args.join(", ")})`;
}

/** Emit a ``LLMCall(prompt=..., client=<modelspec_var>, ...)`` Python
 * literal for an LLM-mode Processor. The client is always resolved
 * from a ModelSpec node — inline (model+api_key inlined on the
 * Processor) was removed; all model declarations are first-class
 * nodes. */
function emitLLMCallCtor(
  d: ProcessorData,
  varName: string,
  modelVarByNodeId: Map<string, string>,
): string {
  const llmArgs: string[] = [
    `prompt=${pyStr(d.llmPrompt)}`,
    `output_field=${pyStr(d.llmOutputField)}`,
  ];
  const modelVar = modelVarByNodeId.get(d.llmClient.modelNodeId);
  if (!modelVar) {
    throw new CodegenError(
      `Processor "${varName}" (LLM mode) needs a ModelSpec node — pick ` +
        `one in the "model spec" dropdown (or drop a ModelSpec on the canvas first)`,
    );
  }
  llmArgs.push(`client=${modelVar}`);
  const raw = d.llmGenKwargs.trim();
  if (raw && raw !== "{}") {
    let parsedKwargs: Record<string, unknown>;
    try {
      parsedKwargs = JSON.parse(raw);
    } catch {
      throw new CodegenError(
        `Processor ${varName} (LLM mode): gen_kwargs must be valid JSON`,
      );
    }
    if (typeof parsedKwargs !== "object" || Array.isArray(parsedKwargs)) {
      throw new CodegenError(
        `Processor ${varName} (LLM mode): gen_kwargs must be a JSON object`,
      );
    }
    for (const [k, v] of Object.entries(parsedKwargs)) {
      checkIdent(k, "gen_kwargs key");
      llmArgs.push(`${k}=${jsonValueToPy(v)}`);
    }
  }
  return `LLMCall(${llmArgs.join(", ")})`;
}

function emitNodeCtor(
  id: string,
  data: AnyNodeData,
  varName: string,
  schemas: SchemaPool,
  fnNamesByNode: Map<string, string>,
  voteCtorByJudgeId: Map<string, string>,
  modelVarByNodeId: Map<string, string>,
): string {
  switch (data.kind) {
    case "RawDataSource": {
      const d = data as RawDataSourceData;
      const sch = getSchemaVar(schemas, d.schema);
      return `${varName} = RawDataSource(${pyStr(d.path)}, schema=${sch}, batch_size=${d.batchSize})`;
    }
    case "DataOutput": {
      const d = data as DataOutputData;
      // The runtime raises NotImplementedError on preserve_order=True. The
      // property panel disables the toggle, but a hand-edited / legacy
      // .cdgraph.json could still carry it — fail clearly here at export
      // rather than emitting code that crashes mid-run.
      if (d.preserveOrder) {
        throw new CodegenError(
          `DataOutput "${varName}": preserve_order=true is not yet implemented ` +
            `(the runtime raises NotImplementedError) — set it back to false.`,
        );
      }
      const sch = getSchemaVar(schemas, d.schema);
      return `${varName} = DataOutput(${pyStr(d.path)}, schema=${sch}, preserve_order=${pyBool(d.preserveOrder)})`;
    }
    case "Processor": {
      const d = data as ProcessorData;
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
      const fn = fnNamesByNode.get(id)!;
      const args = [
        fn,
        `mode=${pyStr(d.mode)}`,
        `input_schema=${inSch}`,
        `output_schema=${outSch}`,
        `intra_batch_workers=${d.intraBatchWorkers}`,
      ];
      return `${varName} = Processor(${args.join(", ")})`;
    }
    case "JoinById": {
      const d = data as JoinByIdData;
      const inSch = getSchemaVar(schemas, d.schema);
      const args = [`key=${pyStr(d.key)}`];
      // Empty fields box -> omit the arg so Python's default (None =
      // "merge every non-empty field") applies. A non-empty list narrows
      // the merge to exactly those fields.
      const fields = d.fields
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (fields.length > 0) {
        args.push(`fields=[${fields.map(pyStr).join(", ")}]`);
      }
      args.push(`expected=${d.expected}`);
      // Only input_schema is emitted: JoinById doesn't reshape rows, so the
      // runtime defaults output_schema to input_schema. Emitting both would
      // risk the runtime's "input_schema must equal output_schema" guard.
      args.push(`input_schema=${inSch}`);
      return `${varName} = JoinById(${args.join(", ")})`;
    }
    case "Judge": {
      const d = data as JudgeData;
      const inSch = getSchemaVar(schemas, d.inputSchema);
      const predicate =
        d.predicate.mode === "code"
          ? fnNamesByNode.get(id)!
          : voteCtorByJudgeId.get(id)!;
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
      throw new CodegenError(
        `internal: tried to emit Vote node ${varName} as a graph node`,
      );
    case "ModelSpec":
      // Should not be called: ModelSpec nodes are emitted as top-level
      // singletons, not as runtime graph nodes.
      throw new CodegenError(
        `internal: tried to emit ModelSpec node ${varName} as a graph node`,
      );
  }
}

function emitModelSpec(data: ModelSpecData, varName: string): {
  decl: string;
  importName: string;
} {
  switch (data.modelKind) {
    case "remote": {
      const args: string[] = [
        `model=${pyStr(data.model)}`,
        `api_key=${pyStr(data.apiKey)}`,
      ];
      if (data.baseUrl.trim()) {
        args.push(`base_url=${pyStr(data.baseUrl)}`);
      }
      // Emit retry/behavior kwargs only when they differ from the Python
      // client's own defaults, so an untouched ModelSpec stays terse.
      if (data.timeout !== 60) args.push(`timeout=${data.timeout}`);
      if (data.maxRetries !== 5) args.push(`max_retries=${data.maxRetries}`);
      if (data.backoffBase !== 1) args.push(`backoff_base=${data.backoffBase}`);
      if (data.backoffMax !== 30) args.push(`backoff_max=${data.backoffMax}`);
      if (data.jitter !== 0.5) args.push(`jitter=${data.jitter}`);
      if (data.onExhaust !== "return_empty") {
        args.push(`on_exhaust=${pyStr(data.onExhaust)}`);
      }
      if (data.includeReasoning === false) {
        args.push(`include_reasoning=False`);
      }
      return {
        decl: `${varName} = OpenAICompatChatClient(${args.join(", ")})`,
        importName: "OpenAICompatChatClient",
      };
    }
    case "local_hf": {
      const args: string[] = [pyStr(data.model)];
      if (data.device.trim()) args.push(`device=${pyStr(data.device)}`);
      if (data.dtype.trim()) args.push(`dtype=${pyStr(data.dtype)}`);
      if (data.cacheDir.trim()) args.push(`cache_dir=${pyStr(data.cacheDir)}`);
      if (data.trustRemoteCode) args.push(`trust_remote_code=True`);
      if (data.maxNewTokens && data.maxNewTokens !== 512) {
        args.push(`max_new_tokens=${data.maxNewTokens}`);
      }
      return {
        decl: `${varName} = LocalHFChatClient(${args.join(", ")})`,
        importName: "LocalHFChatClient",
      };
    }
    case "local_vllm": {
      const args: string[] = [pyStr(data.model)];
      if (data.servedModelName.trim()) {
        args.push(`served_model_name=${pyStr(data.servedModelName)}`);
      }
      if (data.dtype.trim()) args.push(`dtype=${pyStr(data.dtype)}`);
      if (data.tensorParallelSize && data.tensorParallelSize !== 1) {
        args.push(`tensor_parallel_size=${data.tensorParallelSize}`);
      }
      if (
        typeof data.gpuMemoryUtilization === "number" &&
        data.gpuMemoryUtilization !== 0.9
      ) {
        args.push(`gpu_memory_utilization=${data.gpuMemoryUtilization}`);
      }
      if (data.maxModelLen && data.maxModelLen > 0) {
        args.push(`max_model_len=${data.maxModelLen}`);
      }
      if (data.cacheDir.trim()) {
        args.push(`download_dir=${pyStr(data.cacheDir)}`);
      }
      if (data.trustRemoteCode) args.push(`trust_remote_code=True`);
      if (data.startupTimeout && data.startupTimeout !== 600) {
        args.push(`startup_timeout=${data.startupTimeout}`);
      }
      if (data.logPath.trim()) args.push(`log_path=${pyStr(data.logPath)}`);
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

function jsonValueToPy(v: unknown): string {
  if (v === null) return "None";
  if (typeof v === "boolean") return pyBool(v);
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return pyStr(v);
  if (Array.isArray(v)) {
    return `[${v.map(jsonValueToPy).join(", ")}]`;
  }
  if (typeof v === "object") {
    const entries = Object.entries(v).map(
      ([k, val]) => `${pyStr(k)}: ${jsonValueToPy(val)}`,
    );
    return `{${entries.join(", ")}}`;
  }
  throw new CodegenError(`unsupported gen_kwargs value: ${String(v)}`);
}

export interface CodegenOptions {
  /** If a positive int, emit ``Pipeline(...).run(dry_run_rows=N)`` so each
   * RawDataSource caps at N rows and DataOutputs write to ``*.dryrun.*``
   * sibling files. ``undefined`` / ``null`` emits the plain ``.run()``. */
  dryRunRows?: number | null;
}

export function generatePython(
  project: GraphProject,
  options: CodegenOptions = {},
): string {
  if (project.nodes.length === 0) {
    throw new CodegenError("graph is empty");
  }
  const dryRunRows =
    options.dryRunRows != null && options.dryRunRows > 0
      ? Math.floor(options.dryRunRows)
      : null;

  // -- index nodes
  const nodeMap: NodeMap = {};
  for (const n of project.nodes) nodeMap[n.id] = { id: n.id, data: n.data };
  const voteIds = new Set(
    project.nodes.filter((n) => n.data.kind === "Vote").map((n) => n.id),
  );
  const modelSpecIds = new Set(
    project.nodes.filter((n) => n.data.kind === "ModelSpec").map((n) => n.id),
  );
  const floatingIds = new Set<string>([...voteIds, ...modelSpecIds]);

  // -- one or more sources
  const sourceIds = findSources(project);
  const sourceIdSet = new Set(sourceIds);

  // -- topological order over non-floating nodes
  const topo = topoSort(project, floatingIds);

  // -- detect orphans (non-source nodes with no upstream)
  for (const id of topo) {
    if (sourceIdSet.has(id)) continue;
    const hasUpstream = project.edges.some((e) => e.target === id);
    if (!hasUpstream) {
      throw new CodegenError(
        `node "${nodeMap[id].data.varName}" has no upstream — it would never receive data`,
      );
    }
  }

  // -- unique varnames
  const varNames = ensureUniqueVarNames(project.nodes);

  // -- collect user fn defs and assign emission order
  const fnDefs: FnEmit[] = [];
  const fnNamesByNode = new Map<string, string>(); // node id -> emitted fn ident (for Processor / Judge code)
  const fnNamesByVoteId = new Map<string, string[]>(); // vote id -> [fn idents]
  const usedFnNames = new Set<string>();

  const claimFnName = (preferred: string, fallback: string): string => {
    let base = preferred && IDENT_RE.test(preferred) ? preferred : fallback;
    let final = base;
    let i = 2;
    while (usedFnNames.has(final)) final = `${base}_${i++}`;
    usedFnNames.add(final);
    return final;
  };

  for (const n of project.nodes) {
    const v = varNames.get(n.id)!;
    if (n.data.kind === "Processor" && !n.data.llmMode) {
      // LLM-mode Processors don't emit a user fn def — LLMCall is the fn.
      const declared = extractFnName(n.data.fnSource, `${v}_fn`);
      const final = claimFnName(declared, `${v}_fn`);
      fnNamesByNode.set(n.id, final);
      fnDefs.push({ declaredName: declared, source: rewriteFnName(n.data.fnSource, declared, final, `${v}_fn`) });
    } else if (n.data.kind === "Judge" && n.data.predicate.mode === "code") {
      const declared = extractFnName(
        n.data.predicate.fnSource,
        `${v}_predicate`,
      );
      const final = claimFnName(declared, `${v}_predicate`);
      fnNamesByNode.set(n.id, final);
      fnDefs.push({
        declaredName: declared,
        source: rewriteFnName(
          n.data.predicate.fnSource,
          declared,
          final,
          `${v}_predicate`,
        ),
      });
    } else if (n.data.kind === "Vote") {
      const names: string[] = [];
      for (let i = 0; i < n.data.models.length; i++) {
        const m = n.data.models[i];
        const declared = extractFnName(m.fnSource, m.fnName || `${v}_model_${i + 1}`);
        const final = claimFnName(declared, `${v}_model_${i + 1}`);
        names.push(final);
        fnDefs.push({
          declaredName: declared,
          source: rewriteFnName(
            m.fnSource,
            declared,
            final,
            `${v}_model_${i + 1}`,
          ),
        });
      }
      fnNamesByVoteId.set(n.id, names);
    }
  }

  // -- vote ctors needed by Judge nodes
  const voteCtorByJudgeId = new Map<string, string>();
  for (const n of project.nodes) {
    if (n.data.kind !== "Judge") continue;
    if (n.data.predicate.mode !== "voteRef") continue;
    const targetId = n.data.predicate.voteNodeId;
    if (!targetId || !voteIds.has(targetId)) {
      throw new CodegenError(
        `Judge "${n.data.varName}" references unknown Vote node id ${targetId || "(none)"}`,
      );
    }
    const voteData = nodeMap[targetId].data as VoteData;
    voteCtorByJudgeId.set(
      n.id,
      emitVoteCtor(voteData, fnNamesByVoteId, targetId),
    );
  }

  // -- emit ModelSpec singletons (top-level, shared across all references)
  const modelVarByNodeId = new Map<string, string>();
  const modelDeclLines: string[] = [];
  const extraClientImports = new Set<string>();
  for (const n of project.nodes) {
    if (n.data.kind !== "ModelSpec") continue;
    const v = varNames.get(n.id)!;
    const { decl, importName } = emitModelSpec(n.data, v);
    modelVarByNodeId.set(n.id, v);
    modelDeclLines.push(decl);
    extraClientImports.add(importName);
  }

  // -- emit schemas + node ctors
  const schemas = newSchemaPool();
  const ctorLines: string[] = [];
  for (const id of topo) {
    const data = nodeMap[id].data;
    const v = varNames.get(id)!;
    ctorLines.push(
      emitNodeCtor(
        id,
        data,
        v,
        schemas,
        fnNamesByNode,
        voteCtorByJudgeId,
        modelVarByNodeId,
      ),
    );
  }

  // -- edges in topo order
  const { fwd } = buildAdjacency(project);
  const edgeLines: string[] = [];
  for (const id of topo) {
    const outs = (fwd.get(id) ?? []).filter((e) => !floatingIds.has(e.target));
    for (const e of outs) {
      const lhs = varNames.get(id)!;
      const rhs = varNames.get(e.target)!;
      const portExpr =
        e.port === "true"
          ? `${lhs}.on_true`
          : e.port === "false"
          ? `${lhs}.on_false`
          : lhs;
      edgeLines.push(`${portExpr} >> ${rhs}`);
    }
  }

  // -- assemble file
  const sourceVars = sourceIds.map((id) => varNames.get(id)!);
  const pipelineArg =
    sourceVars.length === 1 ? sourceVars[0] : `[${sourceVars.join(", ")}]`;
  const out: string[] = [];
  out.push(
    "# Auto-generated by CargoDash WebUI. Do not hand-edit; round-trip from .cdgraph.json.",
  );
  out.push("from __future__ import annotations");
  out.push("");
  const baseImports = [
    "Schema",
    "RawDataSource",
    "DataOutput",
    "Processor",
    "Judge",
    "JoinById",
    "Vote",
    "LLMCall",
    "Pipeline",
  ];
  const allImports = [...baseImports, ...Array.from(extraClientImports).sort()];
  out.push("from cargodash import (");
  const wrapped = wrapImportList(allImports, 4, 76);
  for (const line of wrapped) out.push(line);
  out.push(")");
  out.push("");
  // Models first so user fns below can reference the variables by name.
  // Function bodies are lazy-evaluated, so the runtime would actually
  // tolerate either order, but top-to-bottom readability matters and
  // users frequently scroll to their fn and want to see what client
  // variable is in scope.
  if (modelDeclLines.length) {
    out.push("# --- model singletons ------------------------------------------------------");
    for (const line of modelDeclLines) out.push(line);
    out.push("");
  }
  if (fnDefs.length) {
    out.push("# --- user functions --------------------------------------------------------");
    for (const f of fnDefs) {
      out.push(trimmedSource(f.source));
    }
  }
  out.push("# --- schemas ---------------------------------------------------------------");
  for (const def of schemas.defs) out.push(def);
  out.push("");
  out.push("# --- nodes -----------------------------------------------------------------");
  for (const line of ctorLines) out.push(line);
  out.push("");
  out.push("# --- edges -----------------------------------------------------------------");
  for (const line of edgeLines) out.push(line);
  out.push("");
  out.push('if __name__ == "__main__":');
  const runArgs = dryRunRows != null ? `dry_run_rows=${dryRunRows}` : "";
  out.push(`    Pipeline(${pipelineArg}).run(${runArgs})`);
  out.push("");

  return out.join("\n");
}

/** Wrap a comma-separated import list to fit within a column budget,
 * indented by ``indent`` spaces. Always emits at least one line. */
function wrapImportList(
  names: string[],
  indent: number,
  maxWidth: number,
): string[] {
  const pad = " ".repeat(indent);
  const lines: string[] = [];
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
    } else {
      current = `${current} ${piece}`;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** If the user wrote `def foo(...):`, but our final emitted name is `foo_2`,
 * rewrite the def header. We only touch the first `def <name>(` occurrence. */
function rewriteFnName(
  src: string,
  declared: string,
  final: string,
  fallback: string,
): string {
  if (declared === final && /^\s*def\s+[A-Za-z_]/m.test(src)) return src;
  // If the user didn't even write a def, wrap a placeholder.
  if (!/^\s*def\s+[A-Za-z_]/m.test(src)) {
    return `def ${final}(*args, **kwargs):\n    raise NotImplementedError(${pyStr(`fill in body for ${fallback}`)})\n`;
  }
  return src.replace(
    /^(\s*def\s+)[A-Za-z_][A-Za-z0-9_]*(\s*\()/m,
    `$1${final}$2`,
  );
}

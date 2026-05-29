// Graph data model. The Zustand store holds React Flow nodes/edges, and each
// node's `data` is one of these tagged variants. Codegen and the properties
// panel both narrow on `kind`.

export type SchemaTypeName = "int" | "float" | "str" | "bool";

export interface SchemaField {
  name: string;
  type: SchemaTypeName;
}

export type NodeKind =
  | "RawDataSource"
  | "DataOutput"
  | "Processor"
  | "Judge"
  | "JoinById"
  | "Vote"
  | "ModelSpec";

/** ModelSpec is a "floating" node (like Vote) referenced by Processor
 * nodes in LLM mode, not connected via DAG edges. Three deployment kinds:
 *   - remote: OpenAI-compatible HTTP endpoint (covers OpenAI, DeepSeek,
 *     externally-running vLLM/SGLang/Ollama, etc.).
 *   - local_hf: in-process `transformers` model. Small models / debugging.
 *   - local_vllm: CargoDash spawns `vllm serve` as a subprocess on open()
 *     and tears it down on close(). For big models that need real throughput.
 *
 * The codegen emits one top-level singleton per ModelSpec, so two Processor
 * nodes referencing the same spec share one loaded model. */
export type ModelKind = "remote" | "local_hf" | "local_vllm";

interface NodeBase {
  kind: NodeKind;
  /** Python variable name in the generated file. Must be a valid identifier. */
  varName: string;
}

export interface RawDataSourceData extends NodeBase {
  kind: "RawDataSource";
  path: string;
  schema: SchemaField[];
  batchSize: number;
}

export interface DataOutputData extends NodeBase {
  kind: "DataOutput";
  path: string;
  schema: SchemaField[];
  preserveOrder: boolean;
}

export type ProcessorMode = "sample" | "batch";

/** LLM-client config for a Processor in LLM mode: always a reference
 * to a ModelSpec node. Inline (model+api_key+base_url on the Processor
 * itself) used to exist but was strictly equivalent to a remote-kind
 * ModelSpec — it's been removed in favor of "every model declaration
 * is a first-class node". Legacy projects are migrated automatically
 * by `migrateProject` on load. */
export type LLMClientConfig = { mode: "modelRef"; modelNodeId: string };

export interface ProcessorData extends NodeBase {
  kind: "Processor";
  /** When true, the Processor's fn is generated as
   * ``LLMCall(prompt=..., client=...)`` from the ``llm*`` fields below.
   * When false, the user-authored fn (``fnSource`` / ``fnName``) is used.
   *
   * Conceptually, LLM mode is a structured shortcut for the most common
   * pattern ("one row in → one LLM call → row with an extra field");
   * the underlying graph node is still a Processor. */
  llmMode: boolean;

  // --- Code mode (llmMode=false) -----------------------------------------
  mode: ProcessorMode;
  /** User-authored Python: must contain a `def fn_name(...)` block. */
  fnSource: string;
  fnName: string;

  // --- LLM mode (llmMode=true) -------------------------------------------
  /** Prompt template; `{field}` placeholders are filled from the row. */
  llmPrompt: string;
  /** Output field on the row that receives the LLM reply. */
  llmOutputField: string;
  llmClient: LLMClientConfig;
  /** Free-form JSON object string forwarded as gen kwargs
   * (``temperature``, ``max_tokens``, ...). */
  llmGenKwargs: string;

  // --- Shared ------------------------------------------------------------
  intraBatchWorkers: number;
  inputSchema: SchemaField[];
  outputSchema: SchemaField[];
}

/** JoinById: stateful per-key fan-in merger. A connected DAG node (unlike
 * floating Vote/ModelSpec) — multiple upstream branches feed its single
 * target handle, and it emits a merged row once ``expected`` branches have
 * reported for the same ``key``. JoinById doesn't reshape rows, so only one
 * schema is exposed (output inherits input in the runtime). */
export interface JoinByIdData extends NodeBase {
  kind: "JoinById";
  /** Row field that identifies which partial rows belong together. */
  key: string;
  /** Comma-separated field names to merge from each contributing upstream.
   * Empty = merge every non-empty field (Python ``fields=None``). Stored
   * raw like ``ModelSpecData.extraArgs``; split at codegen time. */
  fields: string;
  /** How many upstreams must report for the same key before emitting. */
  expected: number;
  schema: SchemaField[];
}

export type JudgeGranularity = "sample" | "batch";

/** Judge predicate is either user-written code OR a reference to a Vote node. */
export type JudgePredicate =
  | { mode: "code"; fnSource: string; fnName: string }
  | { mode: "voteRef"; voteNodeId: string };

export interface JudgeData extends NodeBase {
  kind: "Judge";
  predicate: JudgePredicate;
  granularity: JudgeGranularity;
  intraBatchWorkers: number;
  inputSchema: SchemaField[];
}

export interface VoteModelEntry {
  /** Python source for one model callable. */
  fnSource: string;
  fnName: string;
  /** Optional per-model prompt (Python ``Vote.prompt_list``). When set, the
   * model is called as ``model(sample, prompt)`` — so its fn must accept a
   * second positional arg. Empty/absent = ``model(sample)``. */
  prompt?: string;
}

export interface VoteData extends NodeBase {
  kind: "Vote";
  models: VoteModelEntry[];
  trueNum: number;
}

export interface ModelSpecData extends NodeBase {
  kind: "ModelSpec";
  modelKind: ModelKind;
  /** Repo id for remote/HF, local path for HF/vLLM, model name for remote. */
  model: string;

  // -- remote -------------------------------------------------------------
  apiKey: string;
  baseUrl: string;
  /** Retry / behavior knobs on the generated OpenAICompatChatClient.
   * Defaults below mirror the Python client's own defaults, so an
   * untouched ModelSpec emits no extra kwargs and behaves as before. */
  timeout: number; // seconds per request (Python default 60)
  maxRetries: number; // extra attempts after the first (default 5)
  backoffBase: number; // seconds (default 1)
  backoffMax: number; // seconds (default 30)
  jitter: number; // seconds, 0 = off (default 0.5)
  /** After retries are exhausted: return "" (keep streaming) or raise. */
  onExhaust: "return_empty" | "raise";
  /** Append vendor reasoning_content to the reply (default true). */
  includeReasoning: boolean;

  // -- local_hf + local_vllm ---------------------------------------------
  cacheDir: string;
  trustRemoteCode: boolean;
  /** "" lets the backend pick; otherwise "float16" / "bfloat16" / "float32". */
  dtype: string;

  // -- local_vllm only ----------------------------------------------------
  servedModelName: string;
  tensorParallelSize: number;
  gpuMemoryUtilization: number;
  maxModelLen: number; // 0 = unset
  /** Extra `vllm serve` flags joined by space — escape hatch. */
  extraArgs: string;
  startupTimeout: number;
  logPath: string;

  // -- local_hf only ------------------------------------------------------
  device: string;
  maxNewTokens: number;
}

export type AnyNodeData =
  | RawDataSourceData
  | DataOutputData
  | ProcessorData
  | JudgeData
  | JoinByIdData
  | VoteData
  | ModelSpecData;

/** Custom edge data so we know which named port the edge leaves through. */
export type EdgePort = "default" | "true" | "false";

export interface EdgeData {
  port: EdgePort;
}

/** What we serialize to .cdgraph.json. */
export interface GraphProject {
  version: 1;
  nodes: Array<{
    id: string;
    position: { x: number; y: number };
    data: AnyNodeData;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle: EdgePort;
  }>;
}

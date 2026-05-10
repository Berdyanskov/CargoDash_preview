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
  | "Vote"
  | "LLMCall";

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

export interface ProcessorData extends NodeBase {
  kind: "Processor";
  mode: ProcessorMode;
  /** User-authored Python: must contain a `def fn_name(...)` block. */
  fnSource: string;
  fnName: string;
  intraBatchWorkers: number;
  inputSchema: SchemaField[];
  outputSchema: SchemaField[];
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
}

export interface VoteData extends NodeBase {
  kind: "Vote";
  models: VoteModelEntry[];
  trueNum: number;
}

export interface LLMCallData extends NodeBase {
  kind: "LLMCall";
  prompt: string;
  model: string;
  apiKey: string;
  outputField: string;
  baseUrl: string;
  /** Free-form JSON object string forwarded as gen kwargs. */
  genKwargs: string;
  intraBatchWorkers: number;
  inputSchema: SchemaField[];
  outputSchema: SchemaField[];
}

export type AnyNodeData =
  | RawDataSourceData
  | DataOutputData
  | ProcessorData
  | JudgeData
  | VoteData
  | LLMCallData;

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

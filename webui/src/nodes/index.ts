import type { NodeTypes } from "reactflow";
import { RawDataSourceNode } from "./RawDataSourceNode";
import { DataOutputNode } from "./DataOutputNode";
import { ProcessorNode } from "./ProcessorNode";
import { JudgeNode } from "./JudgeNode";
import { VoteNode } from "./VoteNode";
import { LLMCallNode } from "./LLMCallNode";
import type { NodeKind } from "../types/graph";

export const nodeTypes: NodeTypes = {
  RawDataSource: RawDataSourceNode,
  DataOutput: DataOutputNode,
  Processor: ProcessorNode,
  Judge: JudgeNode,
  Vote: VoteNode,
  LLMCall: LLMCallNode,
};

export const nodeKinds: NodeKind[] = [
  "RawDataSource",
  "DataOutput",
  "Processor",
  "Judge",
  "Vote",
  "LLMCall",
];

export const nodeAccent: Record<NodeKind, string> = {
  RawDataSource: "bg-emerald-600",
  DataOutput: "bg-rose-600",
  Processor: "bg-sky-600",
  Judge: "bg-amber-600",
  Vote: "bg-violet-600",
  LLMCall: "bg-indigo-600",
};

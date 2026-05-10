import { Handle, Position, type NodeProps } from "reactflow";
import type { LLMCallData } from "../types/graph";
import { NodeShell } from "./NodeShell";

export function LLMCallNode({ id, data, selected }: NodeProps<LLMCallData>) {
  return (
    <NodeShell
      id={id}
      title="LLMCall"
      subtitle={data.varName}
      accent="bg-indigo-600"
      selected={selected}
    >
      <Handle type="target" position={Position.Left} />
      <div className="truncate">model: {data.model}</div>
      <div className="text-[10px] text-slate-400">
        → {data.outputField} · workers={data.intraBatchWorkers}
      </div>
      <Handle type="source" position={Position.Right} />
    </NodeShell>
  );
}

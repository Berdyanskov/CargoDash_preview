import { Handle, Position, type NodeProps } from "reactflow";
import type { ProcessorData } from "../types/graph";
import { NodeShell } from "./NodeShell";

export function ProcessorNode({
  id,
  data,
  selected,
}: NodeProps<ProcessorData>) {
  return (
    <NodeShell
      id={id}
      title="Processor"
      subtitle={data.varName}
      accent="bg-sky-600"
      selected={selected}
    >
      <Handle type="target" position={Position.Left} />
      <div>
        mode={data.mode} · workers={data.intraBatchWorkers}
      </div>
      <div className="text-[10px] text-slate-400">fn: {data.fnName}</div>
      <Handle type="source" position={Position.Right} />
    </NodeShell>
  );
}

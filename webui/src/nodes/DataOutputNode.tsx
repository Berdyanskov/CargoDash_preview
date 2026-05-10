import { Handle, Position, type NodeProps } from "reactflow";
import type { DataOutputData } from "../types/graph";
import { NodeShell } from "./NodeShell";

export function DataOutputNode({
  id,
  data,
  selected,
}: NodeProps<DataOutputData>) {
  return (
    <NodeShell
      id={id}
      title="DataOutput"
      subtitle={data.varName}
      accent="bg-rose-600"
      selected={selected}
    >
      <Handle type="target" position={Position.Left} />
      <div className="truncate">{data.path}</div>
      <div className="text-[10px] text-slate-400">
        preserve_order={String(data.preserveOrder)}
      </div>
    </NodeShell>
  );
}

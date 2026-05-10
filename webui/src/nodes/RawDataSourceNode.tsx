import { Handle, Position, type NodeProps } from "reactflow";
import type { RawDataSourceData } from "../types/graph";
import { NodeShell } from "./NodeShell";

export function RawDataSourceNode({
  id,
  data,
  selected,
}: NodeProps<RawDataSourceData>) {
  return (
    <NodeShell
      id={id}
      title="RawDataSource"
      subtitle={data.varName}
      accent="bg-emerald-600"
      selected={selected}
    >
      <div className="truncate">{data.path}</div>
      <div className="text-[10px] text-slate-400">
        batch={data.batchSize} · {data.schema.length} fields
      </div>
      <Handle type="source" position={Position.Right} />
    </NodeShell>
  );
}

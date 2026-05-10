import { Handle, Position, type NodeProps } from "reactflow";
import type { JudgeData } from "../types/graph";
import { NodeShell } from "./NodeShell";

export function JudgeNode({ id, data, selected }: NodeProps<JudgeData>) {
  const predicateLabel =
    data.predicate.mode === "code"
      ? `code: ${data.predicate.fnName}`
      : `vote → ${data.predicate.voteNodeId || "(unset)"}`;
  return (
    <NodeShell
      id={id}
      title="Judge"
      subtitle={data.varName}
      accent="bg-amber-600"
      selected={selected}
    >
      <Handle type="target" position={Position.Left} />
      <div>granularity={data.granularity}</div>
      <div className="text-[10px] text-slate-400">{predicateLabel}</div>
      {/* Two named source handles. Stack them vertically; React Flow uses
          the handle id to populate Connection.sourceHandle. */}
      <div className="relative mt-2 h-8">
        <div className="absolute right-0 top-0 text-[10px] text-emerald-700">
          on_true
        </div>
        <div className="absolute right-0 bottom-0 text-[10px] text-rose-700">
          on_false
        </div>
        <Handle
          id="true"
          type="source"
          position={Position.Right}
          style={{ top: "20%", background: "#059669" }}
        />
        <Handle
          id="false"
          type="source"
          position={Position.Right}
          style={{ top: "80%", background: "#e11d48" }}
        />
      </div>
    </NodeShell>
  );
}

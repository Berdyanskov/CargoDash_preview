import type { NodeProps } from "reactflow";
import type { VoteData } from "../types/graph";
import { NodeShell } from "./NodeShell";

// Vote is referenced by Judge, not connected on the canvas. We render it
// without handles so users see it floating, and Judge's properties panel
// picks it up by id.
export function VoteNode({ id, data, selected }: NodeProps<VoteData>) {
  return (
    <NodeShell
      id={id}
      title="Vote"
      subtitle={data.varName}
      accent="bg-violet-600"
      selected={selected}
    >
      <div>true_num={data.trueNum}</div>
      <div className="text-[10px] text-slate-400">
        {data.models.length} model fn(s)
      </div>
      <div className="text-[10px] text-slate-400 italic">
        referenced by a Judge
      </div>
    </NodeShell>
  );
}

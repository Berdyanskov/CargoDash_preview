import { Handle, Position, type NodeProps } from "reactflow";
import { useGraphStore } from "../store/graphStore";
import type { ProcessorData } from "../types/graph";
import { NodeShell } from "./NodeShell";

export function ProcessorNode({
  id,
  data,
  selected,
}: NodeProps<ProcessorData>) {
  // LLM-mode body: surface the model source (inline string or referenced
  // ModelSpec varname). Subscribes to ModelSpec changes so renaming a
  // ModelSpec updates every Processor that references it.
  // Subscribes to ModelSpec varName so renaming a referenced spec
  // reflects on every Processor that uses it.
  const refModelName = useGraphStore((s) => {
    if (!data.llmMode || !data.llmClient.modelNodeId) return null;
    const n = s.nodes.find((x) => x.id === data.llmClient.modelNodeId);
    return n ? n.data.varName : "(missing ref)";
  });

  return (
    <NodeShell
      id={id}
      title={data.llmMode ? "Processor · LLM" : "Processor"}
      subtitle={data.varName}
      accent={data.llmMode ? "bg-indigo-600" : "bg-sky-600"}
      selected={selected}
    >
      <Handle type="target" position={Position.Left} />
      {data.llmMode ? (
        <>
          <div className="truncate">
            → {refModelName ?? "(pick a ModelSpec)"}
          </div>
          <div className="text-[10px] text-slate-400">
            → {data.llmOutputField} · workers={data.intraBatchWorkers}
          </div>
        </>
      ) : (
        <>
          <div>
            mode={data.mode} · workers={data.intraBatchWorkers}
          </div>
          <div className="text-[10px] text-slate-400">fn: {data.fnName}</div>
        </>
      )}
      <Handle type="source" position={Position.Right} />
    </NodeShell>
  );
}

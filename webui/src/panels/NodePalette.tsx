import { nodeAccent, nodeKinds } from "../nodes";
import type { NodeKind } from "../types/graph";

const descriptions: Record<NodeKind, string> = {
  RawDataSource: "jsonl input source",
  DataOutput: "jsonl sink",
  Processor: "user-defined fn (sample/batch mode)",
  Judge: "split on_true / on_false",
  Vote: "multi-model vote (referenced by Judge)",
  LLMCall: "single-turn OpenAI-compatible call",
};

export function NodePalette() {
  return (
    <div className="h-full overflow-y-auto p-3 space-y-2">
      <div className="text-xs uppercase tracking-wide text-slate-400 px-1">
        Drag to canvas
      </div>
      {nodeKinds.map((kind) => (
        <div
          key={kind}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("application/cargodash-node", kind);
            e.dataTransfer.effectAllowed = "move";
          }}
          className="cursor-grab rounded-md border border-slate-200 bg-white shadow-sm overflow-hidden"
        >
          <div className={`${nodeAccent[kind]} px-2 py-1 text-white text-xs font-medium`}>
            {kind}
          </div>
          <div className="px-2 py-1 text-[11px] text-slate-500">
            {descriptions[kind]}
          </div>
        </div>
      ))}
    </div>
  );
}

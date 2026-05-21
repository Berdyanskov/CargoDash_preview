import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { nodeAccent, nodeKinds } from "../nodes";
const descriptions = {
    RawDataSource: "jsonl input source",
    DataOutput: "jsonl sink",
    Processor: "user-defined fn — toggle LLM mode for single-turn LLM calls",
    Judge: "split on_true / on_false",
    Vote: "multi-model vote (referenced by Judge)",
    ModelSpec: "model deployment (remote / local HF / local vLLM)",
};
export function NodePalette() {
    return (_jsxs("div", { className: "h-full overflow-y-auto p-3 space-y-2", children: [_jsx("div", { className: "text-xs uppercase tracking-wide text-slate-400 px-1", children: "Drag to canvas" }), nodeKinds.map((kind) => (_jsxs("div", { draggable: true, onDragStart: (e) => {
                    e.dataTransfer.setData("application/cargodash-node", kind);
                    e.dataTransfer.effectAllowed = "move";
                }, className: "cursor-grab rounded-md border border-slate-200 bg-white shadow-sm overflow-hidden", children: [_jsx("div", { className: `${nodeAccent[kind]} px-2 py-1 text-white text-xs font-medium`, children: kind }), _jsx("div", { className: "px-2 py-1 text-[11px] text-slate-500", children: descriptions[kind] })] }, kind)))] }));
}

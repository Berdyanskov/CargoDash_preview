import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Handle, Position } from "reactflow";
import { useGraphStore } from "../store/graphStore";
import { NodeShell } from "./NodeShell";
export function ProcessorNode({ id, data, selected, }) {
    // LLM-mode body: surface the model source (inline string or referenced
    // ModelSpec varname). Subscribes to ModelSpec changes so renaming a
    // ModelSpec updates every Processor that references it.
    // Subscribes to ModelSpec varName so renaming a referenced spec
    // reflects on every Processor that uses it.
    const refModelName = useGraphStore((s) => {
        if (!data.llmMode || !data.llmClient.modelNodeId)
            return null;
        const n = s.nodes.find((x) => x.id === data.llmClient.modelNodeId);
        return n ? n.data.varName : "(missing ref)";
    });
    return (_jsxs(NodeShell, { id: id, title: data.llmMode ? "Processor · LLM" : "Processor", subtitle: data.varName, accent: data.llmMode ? "bg-indigo-600" : "bg-sky-600", selected: selected, children: [_jsx(Handle, { type: "target", position: Position.Left }), data.llmMode ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "truncate", children: ["\u2192 ", refModelName ?? "(pick a ModelSpec)"] }), _jsxs("div", { className: "text-[10px] text-slate-400", children: ["\u2192 ", data.llmOutputField, " \u00B7 workers=", data.intraBatchWorkers] })] })) : (_jsxs(_Fragment, { children: [_jsxs("div", { children: ["mode=", data.mode, " \u00B7 workers=", data.intraBatchWorkers] }), _jsxs("div", { className: "text-[10px] text-slate-400", children: ["fn: ", data.fnName] })] })), _jsx(Handle, { type: "source", position: Position.Right })] }));
}

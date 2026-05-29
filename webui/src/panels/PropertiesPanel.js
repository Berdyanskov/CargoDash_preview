import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useGraphStore } from "../store/graphStore";
import { SchemaEditor } from "./SchemaEditor";
import { CodeField } from "./CodeField";
import { Checkbox, Field, NumberInput, Select, TextArea, TextInput, } from "./fields";
export function PropertiesPanel() {
    const selectedId = useGraphStore((s) => s.selectedId);
    const node = useGraphStore((s) => selectedId ? s.nodes.find((n) => n.id === selectedId) : null);
    const updateNodeData = useGraphStore((s) => s.updateNodeData);
    const deleteNode = useGraphStore((s) => s.deleteNode);
    if (!node) {
        return (_jsx("div", { className: "p-4 text-xs text-slate-400", children: "Select a node to edit its properties." }));
    }
    const data = node.data;
    const patch = (p) => updateNodeData(node.id, p);
    return (_jsxs("div", { className: "h-full overflow-y-auto p-3 space-y-3", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs text-slate-400", children: data.kind }), _jsx("div", { className: "text-sm font-semibold", children: data.varName })] }), _jsx("button", { onClick: () => deleteNode(node.id), className: "text-[11px] text-rose-600 hover:underline", children: "delete" })] }), _jsx(Field, { label: "variable name", children: _jsx(TextInput, { value: data.varName, onChange: (v) => patch({ varName: v }) }) }), data.kind === "RawDataSource" && (_jsx(RawDataSourceForm, { data: data, onPatch: patch })), data.kind === "DataOutput" && (_jsx(DataOutputForm, { data: data, onPatch: patch })), data.kind === "Processor" && (_jsx(ProcessorForm, { data: data, onPatch: patch })), data.kind === "Judge" && _jsx(JudgeForm, { data: data, onPatch: patch }), data.kind === "JoinById" && (_jsx(JoinByIdForm, { data: data, onPatch: patch })), data.kind === "Vote" && _jsx(VoteForm, { data: data, onPatch: patch }), data.kind === "ModelSpec" && (_jsx(ModelSpecForm, { data: data, onPatch: patch }))] }));
}
function RawDataSourceForm({ data, onPatch, }) {
    return (_jsxs(_Fragment, { children: [_jsx(Field, { label: "path", children: _jsx(TextInput, { value: data.path, onChange: (v) => onPatch({ path: v }) }) }), _jsx(Field, { label: "batch_size", children: _jsx(NumberInput, { value: data.batchSize, min: 1, onChange: (v) => onPatch({ batchSize: v }) }) }), _jsx(SchemaEditor, { label: "schema", value: data.schema, onChange: (v) => onPatch({ schema: v }) })] }));
}
function DataOutputForm({ data, onPatch, }) {
    return (_jsxs(_Fragment, { children: [_jsx(Field, { label: "path", children: _jsx(TextInput, { value: data.path, onChange: (v) => onPatch({ path: v }) }) }), _jsx(Checkbox, { label: "preserve_order (not yet implemented)", value: data.preserveOrder, disabled: true, onChange: (v) => onPatch({ preserveOrder: v }) }), _jsxs("div", { className: "text-[10.5px] leading-snug text-slate-500 -mt-1", children: ["Rows are written in arrival order. Ordered output needs a source-assigned key plus a reorder buffer at the sink \u2014 not built yet, so the runtime raises ", _jsx("code", { className: "font-mono", children: "NotImplementedError" }), " ", "on ", _jsx("code", { className: "font-mono", children: "preserve_order=True" }), ". Left off until then."] }), _jsx(SchemaEditor, { label: "schema", value: data.schema, onChange: (v) => onPatch({ schema: v }) })] }));
}
function ProcessorForm({ data, onPatch, }) {
    return (_jsxs(_Fragment, { children: [_jsx(Checkbox, { label: "LLM mode (use LLMCall as fn)", value: data.llmMode, onChange: (v) => onPatch({ llmMode: v }) }), _jsx(Field, { label: "intra_batch_workers", children: _jsx(NumberInput, { value: data.intraBatchWorkers, min: 1, onChange: (v) => onPatch({ intraBatchWorkers: v }) }) }), !data.llmMode && data.mode === "batch" && (_jsx("div", { className: "text-[10.5px] leading-snug text-amber-600 -mt-1", children: "Ignored in batch mode \u2014 your fn receives the whole Batch and owns any concurrency itself. (Applies in sample / LLM mode.)" })), data.llmMode ? (_jsx(ProcessorLLMFields, { data: data, onPatch: onPatch })) : (_jsx(ProcessorCodeFields, { data: data, onPatch: onPatch })), _jsx(SchemaEditor, { label: "input_schema", value: data.inputSchema, onChange: (v) => onPatch({ inputSchema: v }) }), _jsx(SchemaEditor, { label: "output_schema", value: data.outputSchema, onChange: (v) => onPatch({ outputSchema: v }) })] }));
}
function ProcessorCodeFields({ data, onPatch, }) {
    return (_jsxs(_Fragment, { children: [_jsx(Field, { label: "mode", children: _jsx(Select, { value: data.mode, options: ["sample", "batch"], onChange: (v) => onPatch({ mode: v }) }) }), _jsx(Field, { label: "fn name (must match def in code below)", children: _jsx(TextInput, { value: data.fnName, onChange: (v) => onPatch({ fnName: v }) }) }), _jsx(CodeField, { label: "fn source", value: data.fnSource, onChange: (v) => onPatch({ fnSource: v }), height: 200 })] }));
}
function ProcessorLLMFields({ data, onPatch, }) {
    const modelSpecs = useGraphStore((s) => s.nodes.filter((n) => n.data.kind === "ModelSpec"));
    const createNode = useGraphStore((s) => s.createNode);
    const onCreateNewModelSpec = () => {
        // Stagger each new ModelSpec diagonally off (100,100) by the number of
        // existing specs, so repeated "+ new" clicks don't pile onto one spot.
        // Selection is intentionally NOT switched (see `createNode` vs
        // `addNode`) so the user stays on the Processor they're configuring.
        const offset = modelSpecs.length * 36;
        const id = createNode("ModelSpec", {
            x: 100 + offset,
            y: 100 + offset,
        });
        onPatch({
            llmClient: { mode: "modelRef", modelNodeId: id },
        });
    };
    return (_jsxs(_Fragment, { children: [_jsx(Field, { label: "model spec", children: _jsxs("div", { className: "flex items-center gap-1", children: [_jsxs("select", { value: data.llmClient.modelNodeId, onChange: (e) => onPatch({
                                llmClient: { mode: "modelRef", modelNodeId: e.target.value },
                            }), className: "flex-1 text-xs px-2 py-1 border rounded", children: [_jsx("option", { value: "", children: "\u2014 pick a ModelSpec node \u2014" }), modelSpecs.map((n) => (_jsxs("option", { value: n.id, children: [n.data.varName, " (", n.data.modelKind, ")"] }, n.id)))] }), _jsx("button", { onClick: onCreateNewModelSpec, title: "Create a fresh ModelSpec node (remote kind) and reference it here", className: "text-[11px] px-2 py-1 rounded border border-slate-300 text-sky-700 hover:bg-sky-50 whitespace-nowrap", children: "+ new" })] }) }), _jsx(Field, { label: "output_field", children: _jsx(TextInput, { value: data.llmOutputField, onChange: (v) => onPatch({ llmOutputField: v }) }) }), _jsx(Field, { label: "prompt template", children: _jsx(TextArea, { value: data.llmPrompt, rows: 4, onChange: (v) => onPatch({ llmPrompt: v }) }) }), _jsx(Field, { label: "gen_kwargs (JSON)", children: _jsx(TextArea, { value: data.llmGenKwargs, rows: 3, onChange: (v) => onPatch({ llmGenKwargs: v }) }) }), _jsxs("div", { className: "text-[10.5px] leading-snug text-slate-500 -mt-1", children: ["Passed through to the underlying SDK as kwargs; not validated. Use OpenAI-style names (", _jsx("code", { className: "font-mono", children: "temperature" }), ",", " ", _jsx("code", { className: "font-mono", children: "max_tokens" }), ",", " ", _jsx("code", { className: "font-mono", children: "top_p" }), ", \u2026) for remote / vLLM-served ModelSpecs. The ", _jsx("code", { className: "font-mono", children: "local_hf" }), " ", "backend goes through ", _jsx("code", { className: "font-mono", children: "transformers.generate" }), ", so use HF names (", _jsx("code", { className: "font-mono", children: "max_new_tokens" }), ",", " ", _jsx("code", { className: "font-mono", children: "do_sample" }), ", \u2026); OpenAI-only kwargs like ", _jsx("code", { className: "font-mono", children: "frequency_penalty" }), " will be rejected. Vendor-specific extras (e.g. DeepSeek", " ", _jsx("code", { className: "font-mono", children: "enable_search" }), ", Qwen", " ", _jsx("code", { className: "font-mono", children: "enable_thinking" }), ") are forwarded as-is \u2014 typos surface at runtime, not export time."] })] }));
}
function JudgeForm({ data, onPatch }) {
    const voteNodes = useGraphStore((s) => s.nodes.filter((n) => n.data.kind === "Vote"));
    return (_jsxs(_Fragment, { children: [_jsx(Field, { label: "granularity", children: _jsx(Select, { value: data.granularity, options: ["sample", "batch"], onChange: (v) => onPatch({ granularity: v }) }) }), _jsx(Field, { label: "intra_batch_workers", children: _jsx(NumberInput, { value: data.intraBatchWorkers, min: 1, onChange: (v) => onPatch({ intraBatchWorkers: v }) }) }), data.granularity === "batch" && (_jsx("div", { className: "text-[10.5px] leading-snug text-amber-600 -mt-1", children: "Ignored at batch granularity \u2014 the predicate is called once on the whole Batch. (Applies at sample granularity.)" })), _jsx(Field, { label: "predicate source", children: _jsx(Select, { value: data.predicate.mode, options: ["code", "voteRef"], onChange: (mode) => {
                        if (mode === "code") {
                            onPatch({
                                predicate: {
                                    mode: "code",
                                    fnSource: "def predicate(row):\n    return True\n",
                                    fnName: "predicate",
                                },
                            });
                        }
                        else {
                            onPatch({
                                predicate: { mode: "voteRef", voteNodeId: voteNodes[0]?.id ?? "" },
                            });
                        }
                    } }) }), data.predicate.mode === "code" ? (_jsxs(_Fragment, { children: [_jsx(Field, { label: "fn name", children: _jsx(TextInput, { value: data.predicate.fnName, onChange: (v) => onPatch({
                                predicate: { ...data.predicate, fnName: v },
                            }) }) }), _jsx(CodeField, { label: "predicate source", value: data.predicate.fnSource, onChange: (v) => onPatch({
                            predicate: { ...data.predicate, fnSource: v },
                        }), height: 200 })] })) : (_jsx(Field, { label: "vote node", children: _jsxs("select", { value: data.predicate.voteNodeId, onChange: (e) => onPatch({
                        predicate: { mode: "voteRef", voteNodeId: e.target.value },
                    }), className: "w-full text-xs px-2 py-1 border rounded", children: [_jsx("option", { value: "", children: "\u2014 pick a Vote node \u2014" }), voteNodes.map((n) => (_jsxs("option", { value: n.id, children: [n.data.varName, " (", n.id, ")"] }, n.id)))] }) })), _jsx(SchemaEditor, { label: "input_schema", value: data.inputSchema, onChange: (v) => onPatch({ inputSchema: v }) })] }));
}
function JoinByIdForm({ data, onPatch, }) {
    return (_jsxs(_Fragment, { children: [_jsx(Field, { label: "key (row field that groups partial rows)", children: _jsx(TextInput, { value: data.key, onChange: (v) => onPatch({ key: v }) }) }), _jsx(Field, { label: "expected (upstreams per key before emit)", children: _jsx(NumberInput, { value: data.expected, min: 1, onChange: (v) => onPatch({ expected: v }) }) }), _jsx(Field, { label: "merge fields (comma-separated; empty = all non-empty fields)", children: _jsx(TextInput, { value: data.fields, placeholder: "answer, score", onChange: (v) => onPatch({ fields: v }) }) }), _jsx(SchemaEditor, { label: "schema (in = out; JoinById doesn't reshape rows)", value: data.schema, onChange: (v) => onPatch({ schema: v }) })] }));
}
function VoteForm({ data, onPatch }) {
    const updateModel = (i, patch) => {
        const next = data.models.slice();
        next[i] = { ...next[i], ...patch };
        onPatch({ models: next });
    };
    const addModel = () => onPatch({
        models: [
            ...data.models,
            {
                fnName: `model_${data.models.length + 1}`,
                fnSource: `def model_${data.models.length + 1}(sample):\n    return True\n`,
            },
        ],
    });
    const removeModel = (i) => onPatch({
        models: data.models.filter((_, j) => j !== i),
    });
    return (_jsxs(_Fragment, { children: [_jsx(Field, { label: "true_num", children: _jsx(NumberInput, { value: data.trueNum, min: 1, onChange: (v) => onPatch({ trueNum: v }) }) }), _jsxs("div", { className: "space-y-3", children: [_jsx("div", { className: "text-[11px] uppercase tracking-wide text-slate-400", children: "model_list" }), _jsxs("div", { className: "text-[10.5px] leading-snug text-slate-500", children: ["Each fn takes a ", _jsx("code", { className: "font-mono", children: "sample" }), " dict and returns truthy/falsy. Set a prompt only if that fn also accepts it (", _jsx("code", { className: "font-mono", children: "model(sample, prompt)" }), "); leave it empty otherwise."] }), data.models.map((m, i) => (_jsxs("div", { className: "border rounded p-2 space-y-2 bg-slate-50", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("input", { value: m.fnName, onChange: (e) => updateModel(i, { fnName: e.target.value }), className: "flex-1 text-xs px-2 py-1 border rounded", placeholder: "fn name" }), _jsx("button", { onClick: () => removeModel(i), className: "text-[11px] text-rose-600", children: "remove" })] }), _jsx(CodeField, { label: `model #${i + 1} source`, value: m.fnSource, onChange: (v) => updateModel(i, { fnSource: v }), height: 120 }), _jsx(Field, { label: "prompt (optional)", children: _jsx(TextInput, { value: m.prompt ?? "", placeholder: "(none \u2014 called as model(sample))", onChange: (v) => updateModel(i, { prompt: v }) }) })] }, i))), _jsx("button", { onClick: addModel, className: "text-[11px] text-sky-600 hover:underline", children: "+ add model fn" })] })] }));
}
function ModelSpecForm({ data, onPatch, }) {
    const setKind = (k) => onPatch({ modelKind: k });
    return (_jsxs(_Fragment, { children: [_jsx(Field, { label: "kind", children: _jsx(Select, { value: data.modelKind, options: ["remote", "local_hf", "local_vllm"], onChange: (v) => setKind(v) }) }), _jsx(Field, { label: "model (HF repo id, local path, or remote model name)", children: _jsx(TextInput, { value: data.model, onChange: (v) => onPatch({ model: v }), placeholder: data.modelKind === "remote"
                        ? "gpt-4.1-mini"
                        : "Qwen/Qwen2.5-7B-Instruct or /share/models/..." }) }), data.modelKind === "remote" && (_jsxs(_Fragment, { children: [_jsx(Field, { label: "api_key", children: _jsx(TextInput, { value: data.apiKey, onChange: (v) => onPatch({ apiKey: v }), placeholder: "sk-..." }) }), _jsx(Field, { label: "base_url (optional)", children: _jsx(TextInput, { value: data.baseUrl, onChange: (v) => onPatch({ baseUrl: v }), placeholder: "https://api.deepseek.com/v1" }) }), _jsx("div", { className: "text-[11px] uppercase tracking-wide text-slate-400 pt-1", children: "retry & behavior" }), _jsx(Field, { label: "max_retries (extra attempts after the first)", children: _jsx(NumberInput, { value: data.maxRetries, min: 0, onChange: (v) => onPatch({ maxRetries: v }) }) }), _jsx(Field, { label: "timeout (s per request)", children: _jsx(NumberInput, { value: data.timeout, min: 1, onChange: (v) => onPatch({ timeout: v }) }) }), _jsx(Field, { label: "on_exhaust (after retries run out)", children: _jsx(Select, { value: data.onExhaust, options: ["return_empty", "raise"], onChange: (v) => onPatch({ onExhaust: v }) }) }), _jsx(Checkbox, { label: "include_reasoning (append reasoning_content to reply)", value: data.includeReasoning, onChange: (v) => onPatch({ includeReasoning: v }) }), _jsx(Field, { label: "backoff_base (s)", children: _jsx(NumberInput, { value: data.backoffBase, min: 0, step: 0.5, onChange: (v) => onPatch({ backoffBase: v }) }) }), _jsx(Field, { label: "backoff_max (s)", children: _jsx(NumberInput, { value: data.backoffMax, min: 0, onChange: (v) => onPatch({ backoffMax: v }) }) }), _jsx(Field, { label: "jitter (s, 0 = off)", children: _jsx(NumberInput, { value: data.jitter, min: 0, step: 0.1, onChange: (v) => onPatch({ jitter: v }) }) }), _jsxs("div", { className: "text-[10.5px] leading-snug text-slate-500 -mt-1", children: ["These configure the generated", " ", _jsx("code", { className: "font-mono", children: "OpenAICompatChatClient" }), " (retry with jittered exponential backoff). A Processor in LLM mode picks up whatever it references here. Only non-default values are written to the exported code."] })] })), (data.modelKind === "local_hf" || data.modelKind === "local_vllm") && (_jsxs(_Fragment, { children: [_jsx(Field, { label: "cache_dir (optional, for HF downloads)", children: _jsx(TextInput, { value: data.cacheDir, onChange: (v) => onPatch({ cacheDir: v }), placeholder: "/path/to/hf_cache" }) }), _jsx(Field, { label: "dtype", children: _jsx(Select, { value: data.dtype || "", options: ["", "float16", "bfloat16", "float32"], onChange: (v) => onPatch({ dtype: v }) }) }), !data.dtype && (_jsx("div", { className: "text-[10.5px] leading-snug text-amber-600 -mt-1", children: "Empty lets the backend default to float32 \u2014 usually wrong for 7B+ models (slow / OOM). Pick float16 or bfloat16 explicitly." })), _jsx(Checkbox, { label: "trust_remote_code", value: data.trustRemoteCode, onChange: (v) => onPatch({ trustRemoteCode: v }) })] })), data.modelKind === "local_hf" && (_jsxs(_Fragment, { children: [_jsx(Field, { label: "device", children: _jsx(TextInput, { value: data.device, onChange: (v) => onPatch({ device: v }), placeholder: "cuda / cpu / cuda:0" }) }), _jsx(Field, { label: "max_new_tokens (default)", children: _jsx(NumberInput, { value: data.maxNewTokens, min: 1, onChange: (v) => onPatch({ maxNewTokens: v }) }) })] })), data.modelKind === "local_vllm" && (_jsxs(_Fragment, { children: [_jsx(Field, { label: "served_model_name (optional)", children: _jsx(TextInput, { value: data.servedModelName, onChange: (v) => onPatch({ servedModelName: v }), placeholder: "(defaults to basename of model)" }) }), _jsx(Field, { label: "tensor_parallel_size", children: _jsx(NumberInput, { value: data.tensorParallelSize, min: 1, onChange: (v) => onPatch({ tensorParallelSize: v }) }) }), _jsx(Field, { label: "gpu_memory_utilization", children: _jsx(NumberInput, { value: data.gpuMemoryUtilization, min: 0, step: 0.05, onChange: (v) => onPatch({ gpuMemoryUtilization: v }) }) }), _jsx(Field, { label: "max_model_len (0 = unset)", children: _jsx(NumberInput, { value: data.maxModelLen, min: 0, onChange: (v) => onPatch({ maxModelLen: v }) }) }), _jsx(Field, { label: "startup_timeout (s)", children: _jsx(NumberInput, { value: data.startupTimeout, min: 1, onChange: (v) => onPatch({ startupTimeout: v }) }) }), _jsx(Field, { label: "log_path (optional)", children: _jsx(TextInput, { value: data.logPath, onChange: (v) => onPatch({ logPath: v }), placeholder: "vllm.log" }) }), _jsx(Field, { label: "extra_args (space-separated)", children: _jsx(TextInput, { value: data.extraArgs, onChange: (v) => onPatch({ extraArgs: v }), placeholder: "--enable-prefix-caching" }) })] })), _jsx(ModelSpecUsage, { varName: data.varName })] }));
}
function ModelSpecUsage({ varName }) {
    // Same chat() interface across all three ChatClient subclasses, so one
    // snippet covers remote / local_hf / local_vllm. Updates live with the
    // node's varName so users can copy-paste into their Processor fn.
    const snippet = `reply = ${varName}.chat(
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": f"...prompt... {row['text']}"},
    ],
    max_tokens=256,
    temperature=0.0,
)
# reply is a str — return / parse whatever shape your Processor wants.

# Vision input? Use OpenAI's list-content format:
#   {"role": "user", "content": [
#       {"type": "text", "text": "..."},
#       {"type": "image_url",
#        "image_url": {"url": "data:image/jpeg;base64,..."}}]}

# Or, for the simple "fill a template, write reply to one field" case,
# flip the Processor's "LLM mode" toggle and pick this ModelSpec in its
# "client source" dropdown — you get batch fan-out for free.`;
    const copy = () => {
        void navigator.clipboard?.writeText(snippet);
    };
    return (_jsxs("div", { className: "space-y-1 pt-2", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-[11px] uppercase tracking-wide text-slate-400", children: "usage example (paste into a Processor.fn or Judge.predicate)" }), _jsx("button", { onClick: copy, className: "text-[10px] text-sky-600 hover:underline", children: "copy" })] }), _jsx("pre", { className: "text-[10.5px] leading-snug bg-slate-50 border rounded p-2 font-mono overflow-x-auto whitespace-pre", children: snippet })] }));
}

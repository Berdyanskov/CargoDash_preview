import { useGraphStore } from "../store/graphStore";
import type {
  AnyNodeData,
  DataOutputData,
  JudgeData,
  JoinByIdData,
  ModelKind,
  ModelSpecData,
  ProcessorData,
  RawDataSourceData,
  VoteData,
  VoteModelEntry,
} from "../types/graph";
import { SchemaEditor } from "./SchemaEditor";
import { CodeField } from "./CodeField";
import {
  Checkbox,
  Field,
  NumberInput,
  Select,
  TextArea,
  TextInput,
} from "./fields";

export function PropertiesPanel() {
  const selectedId = useGraphStore((s) => s.selectedId);
  const node = useGraphStore((s) =>
    selectedId ? s.nodes.find((n) => n.id === selectedId) : null,
  );
  const updateNodeData = useGraphStore((s) => s.updateNodeData);
  const deleteNode = useGraphStore((s) => s.deleteNode);

  if (!node) {
    return (
      <div className="p-4 text-xs text-slate-400">
        Select a node to edit its properties.
      </div>
    );
  }

  const data = node.data;
  const patch = (p: Partial<AnyNodeData>) =>
    updateNodeData(node.id, p as Partial<AnyNodeData>);

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-slate-400">{data.kind}</div>
          <div className="text-sm font-semibold">{data.varName}</div>
        </div>
        <button
          onClick={() => deleteNode(node.id)}
          className="text-[11px] text-rose-600 hover:underline"
        >
          delete
        </button>
      </div>

      <Field label="variable name">
        <TextInput
          value={data.varName}
          onChange={(v) => patch({ varName: v } as Partial<AnyNodeData>)}
        />
      </Field>

      {data.kind === "RawDataSource" && (
        <RawDataSourceForm data={data} onPatch={patch} />
      )}
      {data.kind === "DataOutput" && (
        <DataOutputForm data={data} onPatch={patch} />
      )}
      {data.kind === "Processor" && (
        <ProcessorForm data={data} onPatch={patch} />
      )}
      {data.kind === "Judge" && <JudgeForm data={data} onPatch={patch} />}
      {data.kind === "JoinById" && (
        <JoinByIdForm data={data} onPatch={patch} />
      )}
      {data.kind === "Vote" && <VoteForm data={data} onPatch={patch} />}
      {data.kind === "ModelSpec" && (
        <ModelSpecForm data={data} onPatch={patch} />
      )}
    </div>
  );
}

type Patcher = (p: Partial<AnyNodeData>) => void;

function RawDataSourceForm({
  data,
  onPatch,
}: {
  data: RawDataSourceData;
  onPatch: Patcher;
}) {
  return (
    <>
      <Field label="path">
        <TextInput
          value={data.path}
          onChange={(v) => onPatch({ path: v } as Partial<AnyNodeData>)}
        />
      </Field>
      <Field label="batch_size">
        <NumberInput
          value={data.batchSize}
          min={1}
          onChange={(v) => onPatch({ batchSize: v } as Partial<AnyNodeData>)}
        />
      </Field>
      <SchemaEditor
        label="schema"
        value={data.schema}
        onChange={(v) => onPatch({ schema: v } as Partial<AnyNodeData>)}
      />
    </>
  );
}

function DataOutputForm({
  data,
  onPatch,
}: {
  data: DataOutputData;
  onPatch: Patcher;
}) {
  return (
    <>
      <Field label="path">
        <TextInput
          value={data.path}
          onChange={(v) => onPatch({ path: v } as Partial<AnyNodeData>)}
        />
      </Field>
      <Checkbox
        label="preserve_order (not yet implemented)"
        value={data.preserveOrder}
        disabled
        onChange={(v) =>
          onPatch({ preserveOrder: v } as Partial<AnyNodeData>)
        }
      />
      <div className="text-[10.5px] leading-snug text-slate-500 -mt-1">
        Rows are written in arrival order. Ordered output needs a
        source-assigned key plus a reorder buffer at the sink — not built
        yet, so the runtime raises <code className="font-mono">NotImplementedError</code>{" "}
        on <code className="font-mono">preserve_order=True</code>. Left off
        until then.
      </div>
      <SchemaEditor
        label="schema"
        value={data.schema}
        onChange={(v) => onPatch({ schema: v } as Partial<AnyNodeData>)}
      />
    </>
  );
}

function ProcessorForm({
  data,
  onPatch,
}: {
  data: ProcessorData;
  onPatch: Patcher;
}) {
  return (
    <>
      <Checkbox
        label="LLM mode (use LLMCall as fn)"
        value={data.llmMode}
        onChange={(v) => onPatch({ llmMode: v } as Partial<AnyNodeData>)}
      />
      <Field label="intra_batch_workers">
        <NumberInput
          value={data.intraBatchWorkers}
          min={1}
          onChange={(v) =>
            onPatch({ intraBatchWorkers: v } as Partial<AnyNodeData>)
          }
        />
      </Field>
      {!data.llmMode && data.mode === "batch" && (
        <div className="text-[10.5px] leading-snug text-amber-600 -mt-1">
          Ignored in batch mode — your fn receives the whole Batch and owns
          any concurrency itself. (Applies in sample / LLM mode.)
        </div>
      )}
      {data.llmMode ? (
        <ProcessorLLMFields data={data} onPatch={onPatch} />
      ) : (
        <ProcessorCodeFields data={data} onPatch={onPatch} />
      )}
      <SchemaEditor
        label="input_schema"
        value={data.inputSchema}
        onChange={(v) =>
          onPatch({ inputSchema: v } as Partial<AnyNodeData>)
        }
      />
      <SchemaEditor
        label="output_schema"
        value={data.outputSchema}
        onChange={(v) =>
          onPatch({ outputSchema: v } as Partial<AnyNodeData>)
        }
      />
    </>
  );
}

function ProcessorCodeFields({
  data,
  onPatch,
}: {
  data: ProcessorData;
  onPatch: Patcher;
}) {
  return (
    <>
      <Field label="mode">
        <Select
          value={data.mode}
          options={["sample", "batch"]}
          onChange={(v) => onPatch({ mode: v } as Partial<AnyNodeData>)}
        />
      </Field>
      <Field label="fn name (must match def in code below)">
        <TextInput
          value={data.fnName}
          onChange={(v) => onPatch({ fnName: v } as Partial<AnyNodeData>)}
        />
      </Field>
      <CodeField
        label="fn source"
        value={data.fnSource}
        onChange={(v) => onPatch({ fnSource: v } as Partial<AnyNodeData>)}
        height={200}
      />
    </>
  );
}

function ProcessorLLMFields({
  data,
  onPatch,
}: {
  data: ProcessorData;
  onPatch: Patcher;
}) {
  const modelSpecs = useGraphStore((s) =>
    s.nodes.filter((n) => n.data.kind === "ModelSpec"),
  );
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
    } as Partial<AnyNodeData>);
  };
  return (
    <>
      <Field label="model spec">
        <div className="flex items-center gap-1">
          <select
            value={data.llmClient.modelNodeId}
            onChange={(e) =>
              onPatch({
                llmClient: { mode: "modelRef", modelNodeId: e.target.value },
              } as Partial<AnyNodeData>)
            }
            className="flex-1 text-xs px-2 py-1 border rounded"
          >
            <option value="">— pick a ModelSpec node —</option>
            {modelSpecs.map((n) => (
              <option key={n.id} value={n.id}>
                {n.data.varName} ({(n.data as ModelSpecData).modelKind})
              </option>
            ))}
          </select>
          <button
            onClick={onCreateNewModelSpec}
            title="Create a fresh ModelSpec node (remote kind) and reference it here"
            className="text-[11px] px-2 py-1 rounded border border-slate-300 text-sky-700 hover:bg-sky-50 whitespace-nowrap"
          >
            + new
          </button>
        </div>
      </Field>
      <Field label="output_field">
        <TextInput
          value={data.llmOutputField}
          onChange={(v) =>
            onPatch({ llmOutputField: v } as Partial<AnyNodeData>)
          }
        />
      </Field>
      <Field label="prompt template">
        <TextArea
          value={data.llmPrompt}
          rows={4}
          onChange={(v) => onPatch({ llmPrompt: v } as Partial<AnyNodeData>)}
        />
      </Field>
      <Field label="gen_kwargs (JSON)">
        <TextArea
          value={data.llmGenKwargs}
          rows={3}
          onChange={(v) =>
            onPatch({ llmGenKwargs: v } as Partial<AnyNodeData>)
          }
        />
      </Field>
      <div className="text-[10.5px] leading-snug text-slate-500 -mt-1">
        Passed through to the underlying SDK as kwargs; not validated. Use
        OpenAI-style names (<code className="font-mono">temperature</code>,{" "}
        <code className="font-mono">max_tokens</code>,{" "}
        <code className="font-mono">top_p</code>, …) for remote /
        vLLM-served ModelSpecs. The <code className="font-mono">local_hf</code>{" "}
        backend goes through <code className="font-mono">transformers.generate</code>,
        so use HF names (<code className="font-mono">max_new_tokens</code>,{" "}
        <code className="font-mono">do_sample</code>, …); OpenAI-only kwargs
        like <code className="font-mono">frequency_penalty</code> will be
        rejected. Vendor-specific extras (e.g. DeepSeek{" "}
        <code className="font-mono">enable_search</code>, Qwen{" "}
        <code className="font-mono">enable_thinking</code>) are forwarded
        as-is — typos surface at runtime, not export time.
      </div>
    </>
  );
}

function JudgeForm({ data, onPatch }: { data: JudgeData; onPatch: Patcher }) {
  const voteNodes = useGraphStore((s) =>
    s.nodes.filter((n) => n.data.kind === "Vote"),
  );
  return (
    <>
      <Field label="granularity">
        <Select
          value={data.granularity}
          options={["sample", "batch"]}
          onChange={(v) =>
            onPatch({ granularity: v } as Partial<AnyNodeData>)
          }
        />
      </Field>
      <Field label="intra_batch_workers">
        <NumberInput
          value={data.intraBatchWorkers}
          min={1}
          onChange={(v) =>
            onPatch({ intraBatchWorkers: v } as Partial<AnyNodeData>)
          }
        />
      </Field>
      {data.granularity === "batch" && (
        <div className="text-[10.5px] leading-snug text-amber-600 -mt-1">
          Ignored at batch granularity — the predicate is called once on the
          whole Batch. (Applies at sample granularity.)
        </div>
      )}
      <Field label="predicate source">
        <Select
          value={data.predicate.mode}
          options={["code", "voteRef"]}
          onChange={(mode) => {
            if (mode === "code") {
              onPatch({
                predicate: {
                  mode: "code",
                  fnSource:
                    "def predicate(row):\n    return True\n",
                  fnName: "predicate",
                },
              } as Partial<AnyNodeData>);
            } else {
              onPatch({
                predicate: { mode: "voteRef", voteNodeId: voteNodes[0]?.id ?? "" },
              } as Partial<AnyNodeData>);
            }
          }}
        />
      </Field>
      {data.predicate.mode === "code" ? (
        <>
          <Field label="fn name">
            <TextInput
              value={data.predicate.fnName}
              onChange={(v) =>
                onPatch({
                  predicate: { ...data.predicate, fnName: v },
                } as Partial<AnyNodeData>)
              }
            />
          </Field>
          <CodeField
            label="predicate source"
            value={data.predicate.fnSource}
            onChange={(v) =>
              onPatch({
                predicate: { ...data.predicate, fnSource: v },
              } as Partial<AnyNodeData>)
            }
            height={200}
          />
        </>
      ) : (
        <Field label="vote node">
          <select
            value={data.predicate.voteNodeId}
            onChange={(e) =>
              onPatch({
                predicate: { mode: "voteRef", voteNodeId: e.target.value },
              } as Partial<AnyNodeData>)
            }
            className="w-full text-xs px-2 py-1 border rounded"
          >
            <option value="">— pick a Vote node —</option>
            {voteNodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.data.varName} ({n.id})
              </option>
            ))}
          </select>
        </Field>
      )}
      <SchemaEditor
        label="input_schema"
        value={data.inputSchema}
        onChange={(v) =>
          onPatch({ inputSchema: v } as Partial<AnyNodeData>)
        }
      />
    </>
  );
}

function JoinByIdForm({
  data,
  onPatch,
}: {
  data: JoinByIdData;
  onPatch: Patcher;
}) {
  return (
    <>
      <Field label="key (row field that groups partial rows)">
        <TextInput
          value={data.key}
          onChange={(v) => onPatch({ key: v } as Partial<AnyNodeData>)}
        />
      </Field>
      <Field label="expected (upstreams per key before emit)">
        <NumberInput
          value={data.expected}
          min={1}
          onChange={(v) => onPatch({ expected: v } as Partial<AnyNodeData>)}
        />
      </Field>
      <Field label="merge fields (comma-separated; empty = all non-empty fields)">
        <TextInput
          value={data.fields}
          placeholder="answer, score"
          onChange={(v) => onPatch({ fields: v } as Partial<AnyNodeData>)}
        />
      </Field>
      <SchemaEditor
        label="schema (in = out; JoinById doesn't reshape rows)"
        value={data.schema}
        onChange={(v) => onPatch({ schema: v } as Partial<AnyNodeData>)}
      />
    </>
  );
}

function VoteForm({ data, onPatch }: { data: VoteData; onPatch: Patcher }) {
  const updateModel = (i: number, patch: Partial<VoteModelEntry>) => {
    const next = data.models.slice();
    next[i] = { ...next[i], ...patch };
    onPatch({ models: next } as Partial<AnyNodeData>);
  };
  const addModel = () =>
    onPatch({
      models: [
        ...data.models,
        {
          fnName: `model_${data.models.length + 1}`,
          fnSource: `def model_${data.models.length + 1}(sample):\n    return True\n`,
        },
      ],
    } as Partial<AnyNodeData>);
  const removeModel = (i: number) =>
    onPatch({
      models: data.models.filter((_, j) => j !== i),
    } as Partial<AnyNodeData>);

  return (
    <>
      <Field label="true_num">
        <NumberInput
          value={data.trueNum}
          min={1}
          onChange={(v) => onPatch({ trueNum: v } as Partial<AnyNodeData>)}
        />
      </Field>
      <div className="space-y-3">
        <div className="text-[11px] uppercase tracking-wide text-slate-400">
          model_list
        </div>
        <div className="text-[10.5px] leading-snug text-slate-500">
          Each fn takes a <code className="font-mono">sample</code> dict and
          returns truthy/falsy. Set a prompt only if that fn also accepts it
          (<code className="font-mono">model(sample, prompt)</code>); leave it
          empty otherwise.
        </div>
        {data.models.map((m, i) => (
          <div key={i} className="border rounded p-2 space-y-2 bg-slate-50">
            <div className="flex items-center gap-2">
              <input
                value={m.fnName}
                onChange={(e) => updateModel(i, { fnName: e.target.value })}
                className="flex-1 text-xs px-2 py-1 border rounded"
                placeholder="fn name"
              />
              <button
                onClick={() => removeModel(i)}
                className="text-[11px] text-rose-600"
              >
                remove
              </button>
            </div>
            <CodeField
              label={`model #${i + 1} source`}
              value={m.fnSource}
              onChange={(v) => updateModel(i, { fnSource: v })}
              height={120}
            />
            <Field label="prompt (optional)">
              <TextInput
                value={m.prompt ?? ""}
                placeholder="(none — called as model(sample))"
                onChange={(v) => updateModel(i, { prompt: v })}
              />
            </Field>
          </div>
        ))}
        <button
          onClick={addModel}
          className="text-[11px] text-sky-600 hover:underline"
        >
          + add model fn
        </button>
      </div>
    </>
  );
}

function ModelSpecForm({
  data,
  onPatch,
}: {
  data: ModelSpecData;
  onPatch: Patcher;
}) {
  const setKind = (k: ModelKind) =>
    onPatch({ modelKind: k } as Partial<AnyNodeData>);

  return (
    <>
      <Field label="kind">
        <Select
          value={data.modelKind}
          options={["remote", "local_hf", "local_vllm"]}
          onChange={(v) => setKind(v as ModelKind)}
        />
      </Field>
      <Field label="model (HF repo id, local path, or remote model name)">
        <TextInput
          value={data.model}
          onChange={(v) => onPatch({ model: v } as Partial<AnyNodeData>)}
          placeholder={
            data.modelKind === "remote"
              ? "gpt-4.1-mini"
              : "Qwen/Qwen2.5-7B-Instruct or /share/models/..."
          }
        />
      </Field>

      {data.modelKind === "remote" && (
        <>
          <Field label="api_key">
            <TextInput
              value={data.apiKey}
              onChange={(v) => onPatch({ apiKey: v } as Partial<AnyNodeData>)}
              placeholder="sk-..."
            />
          </Field>
          <Field label="base_url (optional)">
            <TextInput
              value={data.baseUrl}
              onChange={(v) => onPatch({ baseUrl: v } as Partial<AnyNodeData>)}
              placeholder="https://api.deepseek.com/v1"
            />
          </Field>
          <div className="text-[11px] uppercase tracking-wide text-slate-400 pt-1">
            retry &amp; behavior
          </div>
          <Field label="max_retries (extra attempts after the first)">
            <NumberInput
              value={data.maxRetries}
              min={0}
              onChange={(v) => onPatch({ maxRetries: v } as Partial<AnyNodeData>)}
            />
          </Field>
          <Field label="timeout (s per request)">
            <NumberInput
              value={data.timeout}
              min={1}
              onChange={(v) => onPatch({ timeout: v } as Partial<AnyNodeData>)}
            />
          </Field>
          <Field label="on_exhaust (after retries run out)">
            <Select
              value={data.onExhaust}
              options={["return_empty", "raise"]}
              onChange={(v) => onPatch({ onExhaust: v } as Partial<AnyNodeData>)}
            />
          </Field>
          <Checkbox
            label="include_reasoning (append reasoning_content to reply)"
            value={data.includeReasoning}
            onChange={(v) =>
              onPatch({ includeReasoning: v } as Partial<AnyNodeData>)
            }
          />
          <Field label="backoff_base (s)">
            <NumberInput
              value={data.backoffBase}
              min={0}
              step={0.5}
              onChange={(v) => onPatch({ backoffBase: v } as Partial<AnyNodeData>)}
            />
          </Field>
          <Field label="backoff_max (s)">
            <NumberInput
              value={data.backoffMax}
              min={0}
              onChange={(v) => onPatch({ backoffMax: v } as Partial<AnyNodeData>)}
            />
          </Field>
          <Field label="jitter (s, 0 = off)">
            <NumberInput
              value={data.jitter}
              min={0}
              step={0.1}
              onChange={(v) => onPatch({ jitter: v } as Partial<AnyNodeData>)}
            />
          </Field>
          <div className="text-[10.5px] leading-snug text-slate-500 -mt-1">
            These configure the generated{" "}
            <code className="font-mono">OpenAICompatChatClient</code> (retry
            with jittered exponential backoff). A Processor in LLM mode picks
            up whatever it references here. Only non-default values are written
            to the exported code.
          </div>
        </>
      )}

      {(data.modelKind === "local_hf" || data.modelKind === "local_vllm") && (
        <>
          <Field label="cache_dir (optional, for HF downloads)">
            <TextInput
              value={data.cacheDir}
              onChange={(v) =>
                onPatch({ cacheDir: v } as Partial<AnyNodeData>)
              }
              placeholder="/path/to/hf_cache"
            />
          </Field>
          <Field label="dtype">
            <Select
              value={data.dtype || ""}
              options={["", "float16", "bfloat16", "float32"]}
              onChange={(v) => onPatch({ dtype: v } as Partial<AnyNodeData>)}
            />
          </Field>
          {!data.dtype && (
            <div className="text-[10.5px] leading-snug text-amber-600 -mt-1">
              Empty lets the backend default to float32 — usually wrong for
              7B+ models (slow / OOM). Pick float16 or bfloat16 explicitly.
            </div>
          )}
          <Checkbox
            label="trust_remote_code"
            value={data.trustRemoteCode}
            onChange={(v) =>
              onPatch({ trustRemoteCode: v } as Partial<AnyNodeData>)
            }
          />
        </>
      )}

      {data.modelKind === "local_hf" && (
        <>
          <Field label="device">
            <TextInput
              value={data.device}
              onChange={(v) => onPatch({ device: v } as Partial<AnyNodeData>)}
              placeholder="cuda / cpu / cuda:0"
            />
          </Field>
          <Field label="max_new_tokens (default)">
            <NumberInput
              value={data.maxNewTokens}
              min={1}
              onChange={(v) =>
                onPatch({ maxNewTokens: v } as Partial<AnyNodeData>)
              }
            />
          </Field>
        </>
      )}

      {data.modelKind === "local_vllm" && (
        <>
          <Field label="served_model_name (optional)">
            <TextInput
              value={data.servedModelName}
              onChange={(v) =>
                onPatch({ servedModelName: v } as Partial<AnyNodeData>)
              }
              placeholder="(defaults to basename of model)"
            />
          </Field>
          <Field label="tensor_parallel_size">
            <NumberInput
              value={data.tensorParallelSize}
              min={1}
              onChange={(v) =>
                onPatch({ tensorParallelSize: v } as Partial<AnyNodeData>)
              }
            />
          </Field>
          <Field label="gpu_memory_utilization">
            <NumberInput
              value={data.gpuMemoryUtilization}
              min={0}
              step={0.05}
              onChange={(v) =>
                onPatch({ gpuMemoryUtilization: v } as Partial<AnyNodeData>)
              }
            />
          </Field>
          <Field label="max_model_len (0 = unset)">
            <NumberInput
              value={data.maxModelLen}
              min={0}
              onChange={(v) =>
                onPatch({ maxModelLen: v } as Partial<AnyNodeData>)
              }
            />
          </Field>
          <Field label="startup_timeout (s)">
            <NumberInput
              value={data.startupTimeout}
              min={1}
              onChange={(v) =>
                onPatch({ startupTimeout: v } as Partial<AnyNodeData>)
              }
            />
          </Field>
          <Field label="log_path (optional)">
            <TextInput
              value={data.logPath}
              onChange={(v) =>
                onPatch({ logPath: v } as Partial<AnyNodeData>)
              }
              placeholder="vllm.log"
            />
          </Field>
          <Field label="extra_args (space-separated)">
            <TextInput
              value={data.extraArgs}
              onChange={(v) =>
                onPatch({ extraArgs: v } as Partial<AnyNodeData>)
              }
              placeholder="--enable-prefix-caching"
            />
          </Field>
        </>
      )}

      <ModelSpecUsage varName={data.varName} />
    </>
  );
}

function ModelSpecUsage({ varName }: { varName: string }) {
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

  return (
    <div className="space-y-1 pt-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-slate-400">
          usage example (paste into a Processor.fn or Judge.predicate)
        </span>
        <button
          onClick={copy}
          className="text-[10px] text-sky-600 hover:underline"
        >
          copy
        </button>
      </div>
      <pre className="text-[10.5px] leading-snug bg-slate-50 border rounded p-2 font-mono overflow-x-auto whitespace-pre">
        {snippet}
      </pre>
    </div>
  );
}

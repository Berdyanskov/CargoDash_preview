import { useGraphStore } from "../store/graphStore";
import type {
  AnyNodeData,
  DataOutputData,
  JudgeData,
  LLMCallData,
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
      {data.kind === "Vote" && <VoteForm data={data} onPatch={patch} />}
      {data.kind === "LLMCall" && <LLMCallForm data={data} onPatch={patch} />}
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
        label="preserve_order"
        value={data.preserveOrder}
        onChange={(v) =>
          onPatch({ preserveOrder: v } as Partial<AnyNodeData>)
        }
      />
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
      <Field label="mode">
        <Select
          value={data.mode}
          options={["sample", "batch"]}
          onChange={(v) => onPatch({ mode: v } as Partial<AnyNodeData>)}
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

function LLMCallForm({
  data,
  onPatch,
}: {
  data: LLMCallData;
  onPatch: Patcher;
}) {
  return (
    <>
      <Field label="model">
        <TextInput
          value={data.model}
          onChange={(v) => onPatch({ model: v } as Partial<AnyNodeData>)}
        />
      </Field>
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
      <Field label="output_field">
        <TextInput
          value={data.outputField}
          onChange={(v) =>
            onPatch({ outputField: v } as Partial<AnyNodeData>)
          }
        />
      </Field>
      <Field label="prompt template">
        <TextArea
          value={data.prompt}
          rows={4}
          onChange={(v) => onPatch({ prompt: v } as Partial<AnyNodeData>)}
        />
      </Field>
      <Field label="gen_kwargs (JSON)">
        <TextArea
          value={data.genKwargs}
          rows={3}
          onChange={(v) => onPatch({ genKwargs: v } as Partial<AnyNodeData>)}
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

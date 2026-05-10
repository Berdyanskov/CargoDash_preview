import type { SchemaField, SchemaTypeName } from "../types/graph";

const TYPES: SchemaTypeName[] = ["int", "float", "str", "bool"];

interface Props {
  label: string;
  value: SchemaField[];
  onChange: (next: SchemaField[]) => void;
}

export function SchemaEditor({ label, value, onChange }: Props) {
  const update = (i: number, patch: Partial<SchemaField>) => {
    const next = value.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  const add = () =>
    onChange([...value, { name: `field${value.length + 1}`, type: "str" }]);

  return (
    <div className="space-y-1">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="space-y-1">
        {value.map((f, i) => (
          <div key={i} className="flex gap-1 items-center">
            <input
              value={f.name}
              onChange={(e) => update(i, { name: e.target.value })}
              className="flex-1 text-xs px-2 py-1 border rounded"
              placeholder="field name"
            />
            <select
              value={f.type}
              onChange={(e) =>
                update(i, { type: e.target.value as SchemaTypeName })
              }
              className="text-xs px-1 py-1 border rounded"
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button
              onClick={() => remove(i)}
              className="text-xs text-slate-400 hover:text-rose-600 px-1"
              title="remove"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={add}
        className="text-[11px] text-sky-600 hover:underline"
      >
        + add field
      </button>
    </div>
  );
}

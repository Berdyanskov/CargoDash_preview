import Editor from "@monaco-editor/react";

interface Props {
  label: string;
  value: string;
  onChange: (next: string) => void;
  height?: number;
}

export function CodeField({ label, value, onChange, height = 160 }: Props) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="border rounded overflow-hidden">
        <Editor
          height={height}
          defaultLanguage="python"
          value={value}
          onChange={(v) => onChange(v ?? "")}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            lineNumbers: "off",
            scrollBeyondLastLine: false,
            tabSize: 4,
          }}
        />
      </div>
    </div>
  );
}

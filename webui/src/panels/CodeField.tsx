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
            insertSpaces: true,
            // Suggestion popups intercept Space — disable them all so typing
            // a literal space always inserts a space.
            quickSuggestions: false,
            suggestOnTriggerCharacters: false,
            wordBasedSuggestions: "off",
            acceptSuggestionOnEnter: "off",
            acceptSuggestionOnCommitCharacter: false,
            tabCompletion: "off",
            parameterHints: { enabled: false },
            // Predictable: Backspace deletes one char, not a whole indent.
            useTabStops: false,
            autoIndent: "keep",
          }}
        />
      </div>
    </div>
  );
}

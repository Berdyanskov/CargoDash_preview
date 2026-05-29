import { useRef, useState } from "react";
import { Canvas } from "./canvas/Canvas";
import { NodePalette } from "./panels/NodePalette";
import { PropertiesPanel } from "./panels/PropertiesPanel";
import { useGraphStore } from "./store/graphStore";
import { generatePython } from "./codegen/generate";
import type { GraphProject } from "./types/graph";

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const toProject = useGraphStore((s) => s.toProject);
  const loadProject = useGraphStore((s) => s.loadProject);
  const reset = useGraphStore((s) => s.reset);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Per-export setting — not part of the graph, so it lives in local UI
  // state and is not persisted in .cdgraph.json.
  const [dryRunOn, setDryRunOn] = useState(false);
  // Held as a raw string so the field can be cleared / retyped freely; it's
  // parsed and validated at export time rather than silently snapping back
  // to a stale value on invalid input.
  const [dryRunRows, setDryRunRows] = useState("10");

  const onExportPy = () => {
    const project = toProject();
    let dryRunRowsArg: number | null = null;
    if (dryRunOn) {
      const n = parseInt(dryRunRows, 10);
      if (!Number.isFinite(n) || n <= 0) {
        alert("Dry-run rows must be a positive integer.");
        return;
      }
      dryRunRowsArg = n;
    }
    try {
      const code = generatePython(project, { dryRunRows: dryRunRowsArg });
      downloadBlob("pipeline.py", code, "text/x-python");
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const onExportJson = () => {
    const project = toProject();
    downloadBlob(
      "pipeline.cdgraph.json",
      JSON.stringify(project, null, 2),
      "application/json",
    );
  };

  const onImportClick = () => fileInputRef.current?.click();

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as GraphProject;
      loadProject(parsed);
    } catch (err) {
      alert(`Failed to load project: ${(err as Error).message}`);
    } finally {
      e.target.value = "";
    }
  };

  return (
    <div className="h-full flex flex-col">
      <header className="h-12 border-b bg-white flex items-center px-4 gap-2 shrink-0">
        <div className="font-semibold text-slate-800">CargoDash WebUI</div>
        <div className="text-xs text-slate-400">v0.1 preview</div>
        <div className="flex-1" />
        <button
          onClick={onImportClick}
          className="text-xs px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50"
        >
          Import .cdgraph.json
        </button>
        <button
          onClick={onExportJson}
          className="text-xs px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50"
        >
          Export .cdgraph.json
        </button>
        <label
          className="flex items-center gap-1 text-xs text-slate-600 select-none"
          title="Dry-run: cap each RawDataSource to N rows and redirect every DataOutput to a `.dryrun` sibling file. Useful for verifying the pipeline before a full run."
        >
          <input
            type="checkbox"
            checked={dryRunOn}
            onChange={(e) => setDryRunOn(e.target.checked)}
            className="accent-amber-500"
          />
          dry-run
          <input
            type="number"
            min={1}
            value={dryRunRows}
            onChange={(e) => setDryRunRows(e.target.value)}
            disabled={!dryRunOn}
            className="w-14 px-1.5 py-0.5 rounded border border-slate-300 text-right disabled:bg-slate-100 disabled:text-slate-400"
          />
          <span className={dryRunOn ? "text-slate-500" : "text-slate-400"}>
            rows
          </span>
        </label>
        <button
          onClick={onExportPy}
          className="text-xs px-3 py-1.5 rounded bg-slate-800 text-white hover:bg-slate-700"
        >
          Export pipeline.py
        </button>
        <button
          onClick={reset}
          className="text-xs px-2 py-1.5 rounded text-slate-500 hover:bg-slate-100"
        >
          Clear
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={onImportFile}
        />
      </header>
      <div className="flex-1 grid grid-cols-[220px_1fr_320px] min-h-0">
        <aside className="border-r bg-white min-h-0">
          <NodePalette />
        </aside>
        <main className="min-h-0">
          <Canvas />
        </main>
        <aside className="border-l bg-white min-h-0">
          <PropertiesPanel />
        </aside>
      </div>
    </div>
  );
}

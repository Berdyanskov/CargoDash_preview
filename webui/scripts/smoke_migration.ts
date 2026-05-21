// Smoke test for .cdgraph.json back-compat migration.
// Covers:
//   1. Old "LLMCall" node → Processor with llmMode=true
//      (handled by migrateNodeData).
//   2. Old "Processor" missing llm* fields → backfilled with
//      llmMode=false and modelRef-empty defaults.
//   3. Old inline-mode llmClient → modelRef + spawned sibling
//      ModelSpec node (handled by migrateProject).
//   4. Legacy LLMCall with inline client → goes through both
//      passes: kind rewrite + ModelSpec spawn.
//
// Run from webui/:
//   npx tsx scripts/smoke_migration.ts

import {
  migrateNodeData,
  migrateProject,
} from "../src/store/graphStore";
import type {
  GraphProject,
  ModelSpecData,
  ProcessorData,
} from "../src/types/graph";

const fail = (msg: string) => {
  console.error(`[FAIL] ${msg}`);
  process.exit(1);
};

const eq = (a: unknown, b: unknown, msg: string) => {
  if (a !== b) fail(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};

// --- 1) legacy LLMCall node (per-node migration) ---------------------------
const legacyLLMCall = {
  kind: "LLMCall",
  varName: "augment",
  prompt: "Rewrite: {text}",
  outputField: "text",
  client: { mode: "modelRef", modelNodeId: "vllm_1" },
  genKwargs: '{"temperature": 0.7}',
  intraBatchWorkers: 8,
  inputSchema: [{ name: "text", type: "str" }],
  outputSchema: [{ name: "text", type: "str" }],
};
const migrated = migrateNodeData(legacyLLMCall) as ProcessorData;
eq(migrated.kind, "Processor", "LLMCall → Processor: kind");
eq(migrated.varName, "augment", "LLMCall → Processor: varName");
eq(migrated.llmMode, true, "LLMCall → Processor: llmMode");
eq(migrated.llmPrompt, "Rewrite: {text}", "llmPrompt");
eq(migrated.llmOutputField, "text", "llmOutputField");
eq(migrated.llmGenKwargs, '{"temperature": 0.7}', "llmGenKwargs");
eq(migrated.intraBatchWorkers, 8, "intraBatchWorkers");
eq(migrated.llmClient.mode, "modelRef", "client mode");
eq(migrated.llmClient.modelNodeId, "vllm_1", "modelNodeId");

// --- 2) legacy Processor missing llm* fields -------------------------------
const legacyProc = {
  kind: "Processor",
  varName: "clean",
  mode: "sample",
  fnSource: "def clean(row): return row\n",
  fnName: "clean",
  intraBatchWorkers: 1,
  inputSchema: [],
  outputSchema: [],
};
const procMigrated = migrateNodeData(legacyProc) as ProcessorData;
eq(procMigrated.llmMode, false, "old Processor: llmMode backfilled to false");
eq(procMigrated.fnName, "clean", "fnName preserved");
eq(procMigrated.llmClient.mode, "modelRef", "default llmClient is modelRef");
eq(procMigrated.llmClient.modelNodeId, "", "default modelNodeId empty");

// --- 3) inline-mode Processor → ModelSpec spawn (project migration) --------
const inlineProject: GraphProject = {
  version: 1,
  nodes: [
    {
      id: "Processor_1",
      position: { x: 400, y: 200 },
      data: {
        kind: "Processor",
        varName: "augment",
        llmMode: true,
        // Code-mode placeholders required by type, unused.
        mode: "sample",
        fnSource: "",
        fnName: "",
        llmPrompt: "Rewrite: {text}",
        llmOutputField: "text",
        // Legacy inline shape; type-asserted because it's not in the
        // current LLMClientConfig union but must round-trip through
        // migration.
        llmClient: {
          mode: "inline",
          model: "gpt-4.1-mini",
          apiKey: "sk-xyz",
          baseUrl: "https://api.deepseek.com/v1",
        } as unknown as ProcessorData["llmClient"],
        llmGenKwargs: "{}",
        intraBatchWorkers: 4,
        inputSchema: [],
        outputSchema: [],
      } as ProcessorData,
    },
  ],
  edges: [],
};
const out = migrateProject(inlineProject);
eq(out.nodes.length, 2, "inline migration spawns exactly one ModelSpec");
const processor = out.nodes.find((n) => n.data.kind === "Processor")?.data as
  | ProcessorData
  | undefined;
const modelSpec = out.nodes.find((n) => n.data.kind === "ModelSpec")?.data as
  | ModelSpecData
  | undefined;
if (!processor || !modelSpec) fail("expected one Processor and one ModelSpec");
eq(processor!.llmClient.mode, "modelRef", "processor now uses modelRef");
eq(modelSpec!.modelKind, "remote", "spawned ModelSpec is remote-kind");
eq(modelSpec!.model, "gpt-4.1-mini", "ModelSpec inherits model field");
eq(modelSpec!.apiKey, "sk-xyz", "ModelSpec inherits api_key");
eq(modelSpec!.baseUrl, "https://api.deepseek.com/v1", "ModelSpec inherits base_url");
eq(modelSpec!.varName, "augment_model", "ModelSpec varName derived from Processor");
// processor.llmClient.modelNodeId should match the new ModelSpec node id.
const specNodeId = out.nodes.find((n) => n.data.kind === "ModelSpec")?.id;
eq(processor!.llmClient.modelNodeId, specNodeId, "Processor points at new ModelSpec id");

// --- 4) legacy LLMCall + inline client → fully resolved --------------------
const legacyLLMCallProject: GraphProject = {
  version: 1,
  nodes: [
    {
      id: "LLMCall_1",
      position: { x: 0, y: 0 },
      data: {
        kind: "LLMCall",
        varName: "summarize",
        prompt: "Summarize: {text}",
        outputField: "summary",
        client: { mode: "inline", model: "gpt-4", apiKey: "sk", baseUrl: "" },
        genKwargs: "{}",
        intraBatchWorkers: 2,
        inputSchema: [],
        outputSchema: [],
      } as unknown as ProcessorData,
    },
  ],
  edges: [],
};
const out2 = migrateProject(legacyLLMCallProject);
eq(out2.nodes.length, 2, "legacy LLMCall+inline spawns ModelSpec");
const p2 = out2.nodes.find((n) => n.data.kind === "Processor")?.data as
  | ProcessorData
  | undefined;
eq(p2?.llmMode, true, "legacy LLMCall → Processor llmMode=true");
eq(p2?.llmClient.mode, "modelRef", "legacy inline rewritten to modelRef");
const m2 = out2.nodes.find((n) => n.data.kind === "ModelSpec")?.data as
  | ModelSpecData
  | undefined;
eq(m2?.varName, "summarize_model", "spawned ModelSpec varName follows the Processor");

console.error(
  "[OK] migration covers legacy LLMCall, legacy Processor backfill, inline → ModelSpec spawn, and the combined case",
);

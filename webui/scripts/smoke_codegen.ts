// Smoke test: build a GraphProject equivalent to examples/basic_pipeline.py
// and emit the Python code, so we can eyeball the output against the
// hand-written example.
//
// Run from webui/:
//   npx tsx scripts/smoke_codegen.ts
//
// Optional flag --write writes pipeline.smoke.py next to this script.

import { generatePython } from "../src/codegen/generate";
import type { GraphProject, SchemaField } from "../src/types/graph";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const schema: SchemaField[] = [
  { name: "id", type: "int" },
  { name: "text", type: "str" },
  { name: "quality", type: "float" },
];

const project: GraphProject = {
  version: 1,
  nodes: [
    {
      id: "src",
      position: { x: 0, y: 0 },
      data: {
        kind: "RawDataSource",
        varName: "source",
        path: "in.jsonl",
        schema,
        batchSize: 4,
      },
    },
    {
      id: "clean",
      position: { x: 200, y: 0 },
      data: {
        kind: "Processor",
        varName: "clean",
        mode: "sample",
        fnSource:
          "def clean_row(row):\n    return {**row, 'text': row['text'].strip()}\n",
        fnName: "clean_row",
        intraBatchWorkers: 1,
        inputSchema: schema,
        outputSchema: schema,
      },
    },
    {
      id: "vote_q",
      position: { x: 400, y: -150 },
      data: {
        kind: "Vote",
        varName: "quality_vote",
        models: [
          {
            fnName: "quality_model_a",
            fnSource:
              "def quality_model_a(sample):\n    return sample['quality'] >= 0.5\n",
          },
          {
            fnName: "quality_model_b",
            fnSource:
              "def quality_model_b(sample):\n    return sample['quality'] >= 0.6\n",
          },
          {
            fnName: "quality_model_c",
            fnSource:
              "def quality_model_c(sample):\n    return len(sample['text']) >= 5\n",
          },
        ],
        trueNum: 2,
      },
    },
    {
      id: "j_quality",
      position: { x: 400, y: 0 },
      data: {
        kind: "Judge",
        varName: "judge_quality",
        predicate: { mode: "voteRef", voteNodeId: "vote_q" },
        granularity: "sample",
        intraBatchWorkers: 4,
        inputSchema: schema,
      },
    },
    {
      id: "j_lang",
      position: { x: 600, y: -50 },
      data: {
        kind: "Judge",
        varName: "judge_lang",
        predicate: {
          mode: "code",
          fnSource:
            "def is_chinese_batch(batch):\n    chinese = sum(any('一' <= ch <= '鿿' for ch in r['text']) for r in batch.rows)\n    return chinese * 2 >= len(batch)\n",
          fnName: "is_chinese_batch",
        },
        granularity: "batch",
        intraBatchWorkers: 1,
        inputSchema: schema,
      },
    },
    {
      id: "augment",
      position: { x: 800, y: -100 },
      data: {
        kind: "LLMCall",
        varName: "augment",
        prompt: "Please add an argument after the following sentence: {text}",
        model: "gpt-4.1-mini",
        apiKey: "sk-FAKE",
        outputField: "text",
        baseUrl: "",
        genKwargs: '{"temperature": 0.7}',
        intraBatchWorkers: 4,
        inputSchema: schema,
        outputSchema: schema,
      },
    },
    {
      id: "drop",
      position: { x: 600, y: 150 },
      data: {
        kind: "Processor",
        varName: "drop_logger",
        mode: "sample",
        fnSource:
          "def log_drop(row):\n    print(f'  [dropped] id={row[\"id\"]}  quality={row[\"quality\"]}')\n",
        fnName: "log_drop",
        intraBatchWorkers: 1,
        inputSchema: schema,
        outputSchema: schema,
      },
    },
    {
      id: "tgt",
      position: { x: 1000, y: 0 },
      data: {
        kind: "DataOutput",
        varName: "target",
        path: "out.jsonl",
        schema,
        preserveOrder: false,
      },
    },
  ],
  edges: [
    { id: "e1", source: "src", target: "clean", sourceHandle: "default" },
    { id: "e2", source: "clean", target: "j_quality", sourceHandle: "default" },
    { id: "e3", source: "j_quality", target: "j_lang", sourceHandle: "true" },
    { id: "e4", source: "j_quality", target: "drop", sourceHandle: "false" },
    { id: "e5", source: "j_lang", target: "augment", sourceHandle: "true" },
    { id: "e6", source: "j_lang", target: "tgt", sourceHandle: "false" },
    { id: "e7", source: "augment", target: "tgt", sourceHandle: "default" },
  ],
};

const code = generatePython(project);
console.log(code);

if (process.argv.includes("--write")) {
  const out = resolve(import.meta.dirname, "pipeline.smoke.py");
  writeFileSync(out, code);
  console.error(`\n[wrote ${out}]`);
}

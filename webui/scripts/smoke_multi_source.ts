// Smoke test for multi-source codegen.
//
// Builds a graph with two RawDataSource nodes merging into a single
// DataOutput and verifies that generatePython emits
// `Pipeline([source_a, source_b]).run()`.
//
// Run from webui/:
//   npx tsx scripts/smoke_multi_source.ts

import { generatePython } from "../src/codegen/generate";
import type { GraphProject, SchemaField } from "../src/types/graph";

const schema: SchemaField[] = [
  { name: "v", type: "int" },
  { name: "src", type: "str" },
];

const project: GraphProject = {
  version: 1,
  nodes: [
    {
      id: "src_a",
      position: { x: 0, y: 0 },
      data: {
        kind: "RawDataSource",
        varName: "source_a",
        path: "a.jsonl",
        schema,
        batchSize: 4,
      },
    },
    {
      id: "src_b",
      position: { x: 0, y: 100 },
      data: {
        kind: "RawDataSource",
        varName: "source_b",
        path: "b.jsonl",
        schema,
        batchSize: 4,
      },
    },
    {
      id: "tgt",
      position: { x: 400, y: 50 },
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
    { id: "e1", source: "src_a", target: "tgt", sourceHandle: "default" },
    { id: "e2", source: "src_b", target: "tgt", sourceHandle: "default" },
  ],
};

const code = generatePython(project);
console.log(code);

if (!code.includes("Pipeline([source_a, source_b]).run()")) {
  console.error("\n[FAIL] expected `Pipeline([source_a, source_b]).run()` in output");
  process.exit(1);
}
console.error("\n[OK] multi-source Pipeline call emitted as expected");

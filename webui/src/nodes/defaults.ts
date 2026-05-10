import type {
  AnyNodeData,
  NodeKind,
  SchemaField,
} from "../types/graph";

const defaultSchema = (): SchemaField[] => [
  { name: "id", type: "int" },
  { name: "text", type: "str" },
];

export function defaultNodeData(kind: NodeKind, id: string): AnyNodeData {
  const varName = id.toLowerCase();
  switch (kind) {
    case "RawDataSource":
      return {
        kind,
        varName,
        path: "in.jsonl",
        schema: defaultSchema(),
        batchSize: 32,
      };
    case "DataOutput":
      return {
        kind,
        varName,
        path: "out.jsonl",
        schema: defaultSchema(),
        preserveOrder: false,
      };
    case "Processor":
      return {
        kind,
        varName,
        mode: "sample",
        fnSource:
          "def my_fn(row):\n    # row is a dict; return dict / list[dict] / None\n    return row\n",
        fnName: "my_fn",
        intraBatchWorkers: 1,
        inputSchema: defaultSchema(),
        outputSchema: defaultSchema(),
      };
    case "Judge":
      return {
        kind,
        varName,
        predicate: {
          mode: "code",
          fnSource:
            "def predicate(row):\n    # return True or False\n    return True\n",
          fnName: "predicate",
        },
        granularity: "sample",
        intraBatchWorkers: 1,
        inputSchema: defaultSchema(),
      };
    case "Vote":
      return {
        kind,
        varName,
        models: [
          {
            fnSource:
              "def model_a(sample):\n    return True\n",
            fnName: "model_a",
          },
        ],
        trueNum: 1,
      };
    case "LLMCall":
      return {
        kind,
        varName,
        prompt: "Rewrite this sentence: {text}",
        model: "gpt-4.1-mini",
        apiKey: "",
        outputField: "text",
        baseUrl: "",
        genKwargs: "{}",
        intraBatchWorkers: 4,
        inputSchema: defaultSchema(),
        outputSchema: defaultSchema(),
      };
  }
}

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
          "def my_fn(row):\n    # row is a dict; return dict / list[dict] / None.\n    # Fan-in: upstream identity is not exposed here — if your fn needs to\n    # tell upstreams apart, stamp a source tag (e.g. row['src'] = 'a') in\n    # each upstream's output before they converge.\n    return row\n",
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
        outputField: "text",
        client: {
          mode: "inline",
          model: "gpt-4.1-mini",
          apiKey: "",
          baseUrl: "",
        },
        genKwargs: "{}",
        intraBatchWorkers: 4,
        inputSchema: defaultSchema(),
        outputSchema: defaultSchema(),
      };
    case "ModelSpec":
      return {
        kind,
        varName,
        modelKind: "remote",
        model: "gpt-4.1-mini",
        apiKey: "",
        baseUrl: "",
        cacheDir: "",
        trustRemoteCode: false,
        dtype: "",
        servedModelName: "",
        tensorParallelSize: 1,
        gpuMemoryUtilization: 0.9,
        maxModelLen: 0,
        extraArgs: "",
        startupTimeout: 600,
        logPath: "",
        device: "cuda",
        maxNewTokens: 512,
      };
  }
}

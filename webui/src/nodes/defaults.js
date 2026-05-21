const defaultSchema = () => [
    { name: "id", type: "int" },
    { name: "text", type: "str" },
];
export function defaultNodeData(kind, id) {
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
                llmMode: false,
                // Code-mode defaults
                mode: "sample",
                fnSource: "def my_fn(row):\n    # row is a dict; return dict / list[dict] / None.\n    # Fan-in: upstream identity is not exposed here — if your fn needs to\n    # tell upstreams apart, stamp a source tag (e.g. row['src'] = 'a') in\n    # each upstream's output before they converge.\n    return row\n",
                fnName: "my_fn",
                // LLM-mode defaults (used only when llmMode is flipped to true).
                // modelNodeId is empty until the user picks a ModelSpec; codegen
                // will surface a helpful error if they try to export without one.
                llmPrompt: "Rewrite this sentence: {text}",
                llmOutputField: "text",
                llmClient: { mode: "modelRef", modelNodeId: "" },
                llmGenKwargs: "{}",
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
                    fnSource: "def predicate(row):\n    # return True or False\n    return True\n",
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
                        fnSource: "def model_a(sample):\n    return True\n",
                        fnName: "model_a",
                    },
                ],
                trueNum: 1,
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

<p align="center">
  <img src="assets/images/LOGO.png" alt="CargoDash" width="320">
</p>

# CargoDash

> ⚠️ **当前为 Preview 版本（v0.2.0）**：API 与内部实现仍可能在没有兼容性保证的情况下变动，欢迎试用、提 issue，但暂不建议用于生产环境。

CargoDash 是一个用于搭建**简单、模块化、多功能、高效**的大模型训练数据合成 / 增强流水线的 Python 库。核心理念：任何数据处理流水线都可以由**顺序**与**分支**两类原语嵌套组合而成。

## v0.2 新增

- **`LLMCall` —— 调模型即一行**：仅需 `prompt + model + api_key`，即可得到一个可塞进 `Processor` 的节点函数；`base_url` 切到 OpenAI 兼容网关（DeepSeek / Moonshot / 智谱 / vLLM / SGLang / Ollama）皆可
- **`ChatClient` 协议层**：抽出 `ChatClient` / `OpenAICompatChatClient` / `MockChatClient`，后续接原生 vLLM、SGLang 协议时只需新增子类
- **`Processor` 简化为单一类**：合并旧 `MapProcessor`，新增 `mode="sample"`（默认）/ `mode="batch"` 两种模式；调 LLM 走 `mode="sample" + intra_batch_workers=N` 并发
- **执行容错修复**：任一节点抛异常时，executor 保证 SENTINEL 推到全部下游 + 进入 drain 模式排空入口队列，不再级联死锁；错误最终原样上抛

## 特性

- **三类核心原语**：`Processor`（顺序处理）、`Judge`（分支判定，支持 sample / batch 两种粒度）、`Vote`（多模型投票，可作为 Judge 的判定函数）
- **`LLMCall` 一行接入大模型**：内置 OpenAI 兼容 client，覆盖 OpenAI / DeepSeek / 智谱 / Moonshot / 通义 / vLLM / SGLang / Ollama 等
- **以 batch 为流转单元**：模块之间 streaming 传递 batch，`batch_size = 1` 时自然退化为逐条
- **DAG 用 Python 操作符表达**：`>>` 连接节点，`Judge.on_true / on_false` 命名端口表达分支，汇合点通过对象身份自动识别
- **强类型 Schema**：基于 `pyarrow.Schema`，构图阶段静态校验，分支汇合点 schema 一致性检查同样在构图期完成
- **batch 内并行 + 节点间 streaming + 背压**：`intra_batch_workers` 控制 batch 内多样本并发（典型场景：并发调 LLM），节点间有界队列做 streaming 与 backpressure

## 安装

要求 Python ≥ 3.10。

```bash
# Gitee（国内推荐）
git clone https://gitee.com/the-call-of-volgograd/cargo-dash_preview.git

# 或 GitHub
git clone https://github.com/Berdyanskov/CargoDash_preview.git

cd cargo-dash_preview      # 或 CargoDash_preview
pip install -e .
```

核心依赖仅 `pyarrow>=15.0`。如需用 `LLMCall` 调真实 OpenAI 兼容服务，再装 `pip install openai`（`MockChatClient` 不需要）。

## 快速上手

下面这段代码搭建了一个含两层嵌套分支、一处汇合的流水线：先用 3 模型投票筛掉低质量样本，再按语言分支决定是否做扩增，最后写出。

```python
from cargodash import (
    Schema, RawDataSource, DataOutput,
    Processor, Judge, Vote, LLMCall, Pipeline,
)

schema = Schema.of(id=int, text=str, quality=float)

source = RawDataSource("in.jsonl", schema=schema, batch_size=32)
target = DataOutput("out.jsonl", schema=schema)

clean = Processor(lambda r: {**r, "text": r["text"].strip()},
                  input_schema=schema, output_schema=schema)

# LLM 调用节点：只需 prompt + 模型名 + api_key，输出会写到 output_field 指定的列。
# 框架在 batch 内按 intra_batch_workers 并发调用，自动覆盖 OpenAI / 国内
# OpenAI 兼容网关（设 base_url）/ 本地 vLLM / SGLang。
augment = Processor(
    LLMCall(
        prompt="改写这句话，使其更生动：{text}",
        model="gpt-4.1-mini",
        api_key="sk-...",
        output_field="text",
        # base_url="https://api.deepseek.com/v1",   # 国内网关示例
        # temperature=0.7, max_tokens=256,           # 任意 gen kwargs 自动转发
    ),
    input_schema=schema, output_schema=schema,
    intra_batch_workers=8,
)

quality_vote = Vote(
    model_list=[model_a, model_b, model_c],   # 任意 callable: dict -> bool
    true_num=2,
)
judge_quality = Judge(quality_vote, granularity="sample",
                      input_schema=schema, intra_batch_workers=4)
judge_lang    = Judge(is_chinese_batch, granularity="batch",
                      input_schema=schema)

# 构图：>> 表示连边，分支必须从 .on_true / .on_false 接出
source >> clean >> judge_quality
judge_quality.on_true  >> judge_lang
judge_lang.on_true     >> augment >> target
judge_lang.on_false    >> target                  # 与上行汇合到同一 target
judge_quality.on_false >> Processor(log_drop, ...)   # log_drop 由你自己写，
                                                     # 例如 def log_drop(row): print(row); return None
                                                     # 返回 None 即丢弃该样本

Pipeline(source).run()
```

完整可运行示例见 [`examples/basic_pipeline.py`](examples/basic_pipeline.py)。

## 使用流程概览

1. **声明 Schema**：`Schema.of(...)`，可传 python 类型或 `pyarrow.DataType`
2. **构造端点**：`RawDataSource`（jsonl 输入）、`DataOutput`（jsonl 输出）
3. **构造处理节点**：
   - `Processor(fn, mode="sample" | "batch")`：顺序处理。
     - `mode="sample"`（默认）：`fn` 接收单条 row dict，返回 dict / dict 列表 / None；框架在 batch 内 per-sample 调用并按 `intra_batch_workers` 并发
     - `mode="batch"`：`fn` 接收整个 `Batch`，适合 batch 维度操作（去重、排序）
   - `LLMCall(prompt, model, api_key, output_field=...)`：单轮 LLM 调用，作为 `Processor` 的 `fn` 即得到一个调模型节点；`base_url` 可指向任意 OpenAI 兼容服务（DeepSeek / Moonshot / 智谱 / vLLM / SGLang ...），无 OpenAI SDK 时换 `MockChatClient` 即可离线 dry-run
   - `Judge(predicate, granularity="sample" | "batch")`：分支节点
   - `Vote(model_list, true_num)`：多模型投票，可作为 `Judge` 的 `predicate`
4. **用 `>>` 与命名端口连边**：得到一张 DAG
5. **`Pipeline(source).run()`**：构图期校验 schema，运行期每个节点一个 worker 线程 + 节点间有界队列做 streaming 与背压

## 目录结构

```
cargodash/
├── core/        # Module 基类、Port、>> 操作符、Pipeline 构图
├── data_utils/  # Batch、Schema（pyarrow 后端）、节点间队列
├── modules/     # RawDataSource / DataOutput / Processor / Judge
├── voting/      # Vote
├── models/      # ChatClient 抽象 + OpenAI 兼容 client + LLMCall
└── runtime/     # 执行引擎（threading + bounded queue + 节点失败容错）
```

## Roadmap

v0.2 已完成：核心 DAG / Schema / streaming + backpressure / `LLMCall` + OpenAI 兼容 client / 节点失败容错。后续按优先级：

- 内置开箱即用的节点库（text 清洗 / 去重 / 质量分 / SFT 对话合成）
- 原生 vLLM、SGLang 协议（绕开 OpenAI SDK 走更高效的本地路径）
- 失败重试、限流、断点续跑；中间产物版本化（参考 DataFlow `storage.step()`）
- 跨 batch 并发、多进程 / 分布式（threading → multiproc → Ray）
- I/O 格式扩展：parquet / csv / HuggingFace datasets
- `DataOutput` 的 `preserve_order=True`
- `Loop` 作为分支回跳的语法糖
- CLI、可观测性（结构化日志 / 指标 / 追踪）



## 许可证

见 [LICENSE](LICENSE)。

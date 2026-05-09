<p align="center">
  <img src="assets/images/LOGO.png" alt="CargoDash" width="320">
</p>

# CargoDash

> ⚠️ **当前为 Preview 版本（v0.1.0）**：API 与内部实现仍可能在没有兼容性保证的情况下变动，欢迎试用、提 issue，但暂不建议用于生产环境。

CargoDash 是一个用于搭建**简单、模块化、多功能、高效**的大模型训练数据合成 / 增强流水线的 Python 库。核心理念：任何数据处理流水线都可以由**顺序**与**分支**两类原语嵌套组合而成。

## 特性

- **三类核心原语**：`Processor`（顺序处理）、`Judge`（分支判定，支持 sample / batch 两种粒度）、`Vote`（多模型投票，可作为 Judge 的判定函数）
- **以 batch 为流转单元**：模块之间 streaming 传递 batch，`batch_size = 1` 时自然退化为逐条
- **DAG 用 Python 操作符表达**：`>>` 连接节点，`Judge.on_true / on_false` 命名端口表达分支，汇合点通过对象身份自动识别
- **强类型 Schema**：基于 `pyarrow.Schema`，构图阶段静态校验，分支汇合点 schema 一致性检查同样在构图期完成
- **batch 内并行**：`intra_batch_workers` 一行参数控制 batch 内多样本并发（典型场景：并发调用 LLM）

## 安装

要求 Python ≥ 3.10。

```bash
git clone https://gitee.com/the-call-of-volgograd/cargo-dash_preview.git
cd CargoDash
pip install -e .
```

依赖仅 `pyarrow>=15.0`。

## 快速上手

下面这段代码搭建了一个含两层嵌套分支、一处汇合的流水线：先用 3 模型投票筛掉低质量样本，再按语言分支决定是否做扩增，最后写出。

```python
from cargodash import (
    Schema, RawDataSource, DataOutput,
    MapProcessor, Judge, Vote, Pipeline,
)

schema = Schema.of(id=int, text=str, quality=float)

source = RawDataSource("in.jsonl", schema=schema, batch_size=32)
target = DataOutput("out.jsonl", schema=schema)

clean   = MapProcessor(lambda r: {**r, "text": r["text"].strip()},
                       input_schema=schema, output_schema=schema)
augment = MapProcessor(lambda r: {**r, "text": r["text"] + " [AUG]"},
                       input_schema=schema, output_schema=schema,
                       intra_batch_workers=8)

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
judge_quality.on_false >> MapProcessor(log_drop, ...)

Pipeline(source).run()
```

完整可运行示例见 [`examples/basic_pipeline.py`](examples/basic_pipeline.py)。

## 使用流程概览

1. **声明 Schema**：`Schema.of(...)`，可传 python 类型或 `pyarrow.DataType`
2. **构造端点**：`RawDataSource`（jsonl 输入）、`DataOutput`（jsonl 输出）
3. **构造处理节点**：
   - `Processor(fn)`：`fn` 接收一个 `Batch`，yield 0~N 个 `Batch`，适合需要在 batch 维度做事的场景
   - `MapProcessor(fn, intra_batch_workers=N)`：`fn` 接收单条 row dict，框架自动在 batch 内并发应用
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
└── runtime/     # 执行引擎（threading + bounded queue）
```

## Roadmap

Preview 阶段已完成上述 Phase 1 最小骨架；后续计划：

- `DataOutput` 的 `preserve_order=True`（基于源端 ID 与重排缓冲）
- 真实 LLM 客户端集成（OpenAI / vLLM / 本地推理）
- 跨 batch 并发、多进程 / 分布式执行
- 失败重试、限流、断点续跑、可观测性（指标 / 追踪）
- `Loop` 作为分支回跳的语法糖


## 许可证

见 [LICENSE](LICENSE)。

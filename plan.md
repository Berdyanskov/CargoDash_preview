# 项目开发计划

## 1. 项目目标
本项目（CargoDash）是一个 Python 库，用于搭建**简单、模块化、多功能、高效**的大模型训练数据合成 / 增强流水线。核心理念：任何数据处理流水线都可以由**顺序**与**分支**两类原语嵌套组合而成；循环可在后续阶段作为分支的封装语法糖再加入。

## 2. 核心抽象

### 2.1 数据单元：Batch
- 模块之间流动的数据单元一律是 `Batch`，不存在"单条样本"的特殊路径。`batch_size = 1` 时退化为逐条处理。
- `Batch` 是**强类型对象**，绑定一个 `Schema`（字段名 → 类型/约束）。
- 模块在构造时声明 `input_schema` 与 `output_schema`，`Pipeline` 在构图阶段做**静态校验**（含分支汇合点的 schema 一致性检查），构图失败立即报错，不等到运行时。

### 2.2 模块（Module）通用契约
所有模块统一暴露：
- `input_schema` / `output_schema`
- `process(batch: Batch) -> Iterable[Batch]`（允许 N→M：过滤、扩增、保持均可）
- 构造参数 `intra_batch_workers: int = 1`，控制 batch 内多样本并行度（默认串行）
- 模块之间是 **streaming**：上游产出一个 batch，下游即可开始消费，不必等上游全部完成

### 2.3 三类模块原语

| 类 | 角色 | 输出端口 |
|---|---|---|
| `Processor(fn)` | 顺序处理。`fn: Batch -> Iterable[Batch]`，允许 N→M | 单一下游 |
| `Judge(fn_or_vote, granularity="sample")` | 分支判定。`granularity` 可选 `"sample"`（默认，逐条判，batch 在此被拆成 true / false 两份）或 `"batch"`（整批一个判定，节省调用成本，容忍少量噪声） | `judge.on_true` / `judge.on_false` |
| `Vote(model_list, true_num, prompt_list)` | 多模型投票，可作为 `Judge` 的判定函数。`model_list` 长度为 1 时退化为单模型判断 | — |

### 2.4 端点模块
- `RawDataSource(path, schema)`：流式读入数据，产出 `Batch`
- `DataOutput(path, preserve_order=False)`：消费 `Batch` 并落盘
  - `preserve_order=True`：按源顺序输出（引入缓冲与背压，适合无样本 ID 的场景）
  - `preserve_order=False`（默认）：按到达顺序输出，由用户用样本 ID 自行追溯

## 3. DAG 表达：操作符重载 + 命名端口

放弃字符串 DAG。采用 Python 操作符重载，分支节点暴露 `on_true` / `on_false` 命名端口。**汇合点通过 Python 对象身份识别为同一节点**，因此天然支持任意 DAG（含嵌套分支）。

```python
from cargodash import RawDataSource, DataOutput, Processor, Judge, Vote, Pipeline

source = RawDataSource("in.jsonl", schema=...)
target = DataOutput("out.jsonl", preserve_order=False)

clean   = Processor(clean_fn)
augment = Processor(augment_fn, intra_batch_workers=8)

judge_quality = Judge(Vote(model_list=[...], true_num=3, prompt_list=[...]),
                      granularity="sample")
judge_lang    = Judge(is_chinese, granularity="batch")

# 主干
source >> clean >> judge_quality

# 高质量分支：再按语言分支，最后汇合到同一 target
judge_quality.on_true >> judge_lang
judge_lang.on_true    >> augment >> target
judge_lang.on_false   >> target

# 低质量分支：直接丢弃（不连到 target）
judge_quality.on_false >> Processor(log_drop)

pipeline = Pipeline(source)   # 从源遍历得到完整 DAG
pipeline.run()
```

**构图规则**
- `a >> b` 表示 b 是 a 的下游，返回 b 以便继续链式
- `judge.on_true` / `judge.on_false` 是端口对象，作为左操作数即代表"该分支的输出"
- 汇合（多个上游 → 同一下游）：所有上游的 `output_schema` 必须一致，否则构图期报错
- 嵌套分支：在 `on_true` / `on_false` 子链上再放 `Judge` 即可，无需特殊语法

## 4. 执行模型
- **流水线之间**：streaming，模块间用有界队列连接，下游 backpressure 自然传导
- **模块内部**：仅支持 batch 内并行（`intra_batch_workers`），即一个 batch 内的多个样本并发处理。典型场景：一个 batch 中的多条样本并发调用 LLM
- **不**在本阶段支持：跨 batch 并发、多进程、分布式
- 失败处理、断点续跑、限流重试：列入后续阶段，本阶段先保证单进程跑通

## 5. 待实现的最小可用版本（Phase 1）
1. `Batch` / `Schema` 数据类型 + 静态校验
2. `RawDataSource`（jsonl）、`DataOutput`（jsonl，两种顺序模式）
3. `Processor`（含 `intra_batch_workers`）
4. `Judge`（支持 `sample` / `batch` 两种粒度）
5. `Vote`（占位实现：接受可调用模型对象列表，返回投票结果）
6. `>>` / `on_true` / `on_false` 构图 + DAG 遍历执行器
7. 端到端示例 + 单元测试

## 6. 推迟到后续阶段
- `Loop`：作为"分支回跳"的封装语法糖
- 跨 batch 并发 / 多进程 / 分布式执行
- 失败重试、限流、断点续跑、可观测性（指标、追踪）
- 真实 LLM 客户端集成（OpenAI / vLLM / 本地推理）—— Phase 1 用 mock 模型即可

## 7. 仍未决 / 实现期再定
- `Schema` 的具体实现（自研 dataclass / 复用 pydantic / 复用 pyarrow）
- `Vote` 的提示词模板与解析协议
- `RawDataSource` / `DataOutput` 是否支持除 jsonl 之外的格式
- 分支 `granularity="sample"` 时，下游是否需要"重新攒批"以保持 batch 大小稳定，还是允许下游接收变小的 batch

## 实现规划
### 目录
根目录：CargoDash
1级子目录：
modules/：用于定义各模块，包括RawDataSource、DataOutput、Judge、Processor，即有向图pipeline中的“节点”
data_utils/：用于
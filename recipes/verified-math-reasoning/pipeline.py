"""verified-math-reasoning recipe — 3-model fan-out + program verification.

  source -> judge_decontam -+- on_false -> drop
                            +- on_true -+- gen_a (DeepSeek) -+
                                        +- gen_b (Doubao)   +- join -> parse_verify
                                        +- gen_c (Qwen)     +
   parse_verify -> judge_solvable -+- on_false -> tag_unsolved   -> out_unsolved
                                   +- on_true -> judge_consensus -+- on_true  -> tag_easy -> out_clean
                                                                  +- on_false -> tag_hard -> out_disagreement

Run (real API, public endpoints):
    export DEEPSEEK_API_KEY=...   # api.deepseek.com
    export DOUBAO_API_KEY=...     # Volces ARK
    export QWEN_API_KEY=...       # DashScope
    python recipes/verified-math-reasoning/pipeline.py

Override endpoints (private vLLM / SGLang / Azure / etc.):
    export DEEPSEEK_BASE_URL=https://your-deepseek-host/v1
    export DEEPSEEK_MODEL=...
    export QWEN_BASE_URL=https://your-qwen-host/v1
    export QWEN_MODEL=Qwen3.5-...
    # If endpoints resolve to private IPs and a SOCKS/HTTP proxy is set
    # (Clash etc.), bypass it for those hosts:
    export NO_PROXY="$NO_PROXY,your-host.example.com"
"""
from __future__ import annotations
import os
import sys
from pathlib import Path

# Make the recipe runnable without installing the package.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from cargodash import (
    Schema, RawDataSource, DataOutput, Processor, Judge, Vote, JoinById,
    LLMCall, Pipeline, OpenAICompatChatClient,
)

sys.path.insert(0, str(Path(__file__).resolve().parent))
from verifier import extract_boxed_or_number, numeric_equal, in_test_benchmarks


HERE = Path(__file__).resolve().parent


# --- model singletons ------------------------------------------------------
# Three heterogeneous models — fan-out generates one CoT per model per
# problem; their agreement/disagreement is the dataset signal.
# `OpenAICompatChatClient` brings retry + `reasoning_content` fallback
# natively, so each call here gets jittered exponential backoff on
# transient failures and surfaces hidden-reasoning output when a model
# exhausts max_tokens before emitting visible content.
#
# All three endpoints are configurable. Defaults point at each vendor's
# public OpenAI-compatible endpoint. Override via env vars if you have a
# private deployment (e.g. SII vLLM, your own vLLM, Azure OpenAI, …):
#   export DEEPSEEK_BASE_URL=... DEEPSEEK_MODEL=...
#   export DOUBAO_BASE_URL=...   DOUBAO_MODEL=...
#   export QWEN_BASE_URL=...     QWEN_MODEL=...

deepseek = OpenAICompatChatClient(
    model=os.environ.get("DEEPSEEK_MODEL", "deepseek-reasoner"),
    base_url=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
    api_key=os.environ["DEEPSEEK_API_KEY"],
    timeout=300.0,
)
doubao = OpenAICompatChatClient(
    model=os.environ.get("DOUBAO_MODEL", "doubao-seed-2-0-pro-260215"),
    base_url=os.environ.get("DOUBAO_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3"),
    api_key=os.environ["DOUBAO_API_KEY"],
    timeout=300.0,
)
qwen = OpenAICompatChatClient(
    # DashScope-compatible defaults. If you have a Qwen3.x reasoning-capable
    # deployment, set QWEN_MODEL and confirm the endpoint accepts the
    # `chat_template_kwargs.enable_thinking=False` parameter passed below.
    model=os.environ.get("QWEN_MODEL", "qwen-plus"),
    base_url=os.environ.get("QWEN_BASE_URL",
                            "https://dashscope.aliyuncs.com/compatible-mode/v1"),
    api_key=os.environ["QWEN_API_KEY"],
    timeout=300.0,
)


# --- user functions --------------------------------------------------------

COT_PROMPT = (
    "Reason step by step, then put the final answer inside \\boxed{{}}.\n\n"
    "Problem: {problem}"
)


def parse_and_verify(row: dict) -> dict:
    """Pull each model's `\\boxed{}` answer out of its CoT, compare to the
    reference numerically, count agreement. Empty sol_x extracts to "" and
    counts as wrong — JoinById emits even when a model returned empty.

    Also flips `synthetic` to True: rows reaching this node carry AI-
    generated `sol_a/b/c` content. Per China's《人工智能生成合成内容标识办法》
    every published row carries this explicit label (NOTICE.md elaborates).
    """
    ans = {k: extract_boxed_or_number(row[f"sol_{k}"]) for k in "abc"}
    correct = {k: numeric_equal(ans[k], row["reference_answer"]) for k in "abc"}
    return {
        **row,
        "ans_a": ans["a"], "ans_b": ans["b"], "ans_c": ans["c"],
        "correct_a": correct["a"], "correct_b": correct["b"], "correct_c": correct["c"],
        "num_correct": sum(correct.values()),
        "synthetic": True,
    }


def tag(difficulty: str, split: str):
    return lambda row: {**row, "difficulty": difficulty, "split": split}


def log_decontam_drop(row: dict) -> None:
    print(f"[decontam] drop id={row['id']}  {row['problem'][:60]!r}",
          file=sys.stderr)


# --- schemas ---------------------------------------------------------------

SCHEMA = Schema.of(
    id=str, source=str, problem=str, reference_answer=str,
    sol_a=str, sol_b=str, sol_c=str,
    ans_a=str, ans_b=str, ans_c=str,
    correct_a=bool, correct_b=bool, correct_c=bool,
    num_correct=int,
    difficulty=str, split=str,
    # Explicit AI-generated-content flag (China《人工智能生成合成内容标识办法》compliance).
    # False on seed rows, flipped to True by parse_and_verify once the row
    # carries model-generated sol_a/b/c. See NOTICE.md.
    synthetic=bool,
)


# --- nodes -----------------------------------------------------------------

source = RawDataSource(HERE / "_numina_1k.jsonl", schema=SCHEMA, batch_size=16)

judge_decontam = Judge(
    lambda s: not in_test_benchmarks(s["problem"]),
    granularity="sample", input_schema=SCHEMA, intra_batch_workers=2,
    name="judge_decontam",
)
drop_contaminated = Processor(
    log_decontam_drop, input_schema=SCHEMA, output_schema=SCHEMA,
    name="drop_contaminated",
)


def _gen(client: OpenAICompatChatClient, field: str, *, max_tokens=16384,
         extra_body=None) -> Processor:
    kwargs = dict(prompt=COT_PROMPT, client=client, output_field=field,
                  max_tokens=max_tokens, temperature=0)
    if extra_body is not None:
        kwargs["extra_body"] = extra_body
    return Processor(
        LLMCall(**kwargs),
        input_schema=SCHEMA, output_schema=SCHEMA, intra_batch_workers=8,
        name=f"gen_{field[-1]}",
    )


gen_a = _gen(deepseek, "sol_a")
gen_b = _gen(doubao, "sol_b")
# Qwen non-thinking: heterogeneity comes from "two reasoning models +
# one fast non-reasoning model" — and Qwen's vLLM has a ~180s server-side
# stream timeout that long reasoning calls overflow. Disabling thinking
# keeps each call ~30-40s and produces a clean visible answer.
gen_c = _gen(qwen, "sol_c", max_tokens=8192,
             extra_body={"chat_template_kwargs": {"enable_thinking": False}})

join = JoinById(key="id", fields=("sol_a", "sol_b", "sol_c"), expected=3,
                input_schema=SCHEMA, name="join_sols")

parse_verify = Processor(parse_and_verify,
                         input_schema=SCHEMA, output_schema=SCHEMA, name="parse_verify")

judge_solvable = Judge(lambda s: s["num_correct"] >= 1,
                       granularity="sample", input_schema=SCHEMA, name="judge_solvable")

judge_consensus = Judge(Vote(
    model_list=[lambda s: s["correct_a"], lambda s: s["correct_b"], lambda s: s["correct_c"]],
    true_num=3,
), granularity="sample", input_schema=SCHEMA, name="judge_consensus")

tag_easy = Processor(tag("easy", "train_clean"),
                     input_schema=SCHEMA, output_schema=SCHEMA, name="tag_easy")
tag_hard = Processor(tag("hard", "hard_disagreement"),
                     input_schema=SCHEMA, output_schema=SCHEMA, name="tag_hard")
tag_unsolved = Processor(tag("unsolved", "unsolved_flagged"),
                         input_schema=SCHEMA, output_schema=SCHEMA, name="tag_unsolved")

out_clean = DataOutput(HERE / "out_train_clean.jsonl", schema=SCHEMA, name="out_clean")
out_hard = DataOutput(HERE / "out_hard_disagreement.jsonl", schema=SCHEMA, name="out_hard")
out_unsolved = DataOutput(HERE / "out_unsolved_flagged.jsonl", schema=SCHEMA, name="out_unsolved")


# --- edges -----------------------------------------------------------------

source >> judge_decontam
judge_decontam.on_false >> drop_contaminated
judge_decontam.on_true >> gen_a
judge_decontam.on_true >> gen_b
judge_decontam.on_true >> gen_c
gen_a >> join
gen_b >> join
gen_c >> join
join >> parse_verify >> judge_solvable
judge_solvable.on_false >> tag_unsolved >> out_unsolved
judge_solvable.on_true >> judge_consensus
judge_consensus.on_true >> tag_easy >> out_clean
judge_consensus.on_false >> tag_hard >> out_hard


if __name__ == "__main__":
    Pipeline(source).run()

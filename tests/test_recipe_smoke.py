"""Smoke test: the verified-math-reasoning recipe runs end-to-end.

Network-free. Mocks the three LLM clients with deterministic
`\\boxed{...}` answers and stubs the decontamination index so CI
doesn't have to download benchmark parquets. Exists to catch CargoDash
changes that silently break the flagship recipe (fan-out + JoinById +
verifier + sink plumbing).

If a framework change makes this test fail without touching the recipe
files, the change has broken the recipe contract.
"""
from __future__ import annotations
import importlib
import sys
from pathlib import Path

import pytest


RECIPE_DIR = Path(__file__).resolve().parent.parent / "recipes" / "verified-math-reasoning"


def test_recipe_smoke(monkeypatch):
    # 1. Recipe pipeline reads API keys at import time -- supply dummies.
    monkeypatch.setenv("DEEPSEEK_API_KEY", "dummy")
    monkeypatch.setenv("DOUBAO_API_KEY", "dummy")
    monkeypatch.setenv("QWEN_API_KEY", "dummy")

    # 2. Replace each OpenAICompatChatClient with a MockChatClient that
    # detects the seed problem from the prompt and emits a deterministic
    # answer per (model, problem). Three constructed clients in the order
    # gen_a / gen_b / gen_c (deepseek / doubao / qwen).
    from cargodash import MockChatClient

    # _demo_seeds.jsonl content (5 rows; dry_run_rows=3 takes first 3):
    #   p001 ref=8   apples problem
    #   p002 ref=42  6*7 problem
    #   p003 ref=60  triangle problem
    # Mock plan:
    #   model_a: always correct  -> sol_a==ref for all 3
    #   model_b: always correct  -> sol_b==ref for all 3
    #   model_c: correct on p001+p003, wrong on p002 -> exercises both
    #            train_clean (TTT) and hard_disagreement (TTF) buckets
    REFS = {
        "apples": "8",
        "6 times 7": "42",
        "triangle": "60",
    }

    def _detect_ref(prompt: str) -> str:
        for kw, ref in REFS.items():
            if kw in prompt.lower():
                return ref
        return "0"

    def _make_responder(letter: str):
        def respond(messages):
            ref = _detect_ref(messages[-1]["content"])
            if letter in ("a", "b"):
                ans = ref
            else:   # c: correct except on the 6*7 problem
                ans = ref if ref != "42" else "43"
            return f"Reasoning… \\boxed{{{ans}}}."
        return respond

    client_letters = iter(["a", "b", "c"])

    def patched_ctor(*args, **kwargs):
        letter = next(client_letters)
        return MockChatClient(response_fn=_make_responder(letter))

    monkeypatch.setattr("cargodash.OpenAICompatChatClient", patched_ctor)

    # 3. Stub decontamination so we don't download benchmark parquets in CI.
    sys.path.insert(0, str(RECIPE_DIR))
    import decontam  # noqa: E402
    monkeypatch.setattr(decontam, "_build_index",
                        lambda: (frozenset(), frozenset()))

    # 4. Force a clean import (drop any stale module from a prior test run).
    sys.modules.pop("pipeline", None)
    sys.modules.pop("verifier", None)
    pipeline = importlib.import_module("pipeline")

    # 5. Override seeds to the small demo file (the env-default 1k seeds
    # might not exist in a fresh clone).
    pipeline.source.path = RECIPE_DIR / "_demo_seeds.jsonl"

    # 6. Run on 3 rows; dry_run redirects DataOutput to *.dryrun.jsonl so
    # production output is untouched.
    pipeline.Pipeline(pipeline.source).run(dry_run_rows=3)

    clean = RECIPE_DIR / "out_train_clean.dryrun.jsonl"
    hard = RECIPE_DIR / "out_hard_disagreement.dryrun.jsonl"
    unsolved = RECIPE_DIR / "out_unsolved_flagged.dryrun.jsonl"

    try:
        # All three sink files were opened (DataOutput.open() creates them
        # before the executor runs)
        assert clean.exists() and hard.exists() and unsolved.exists()

        n_clean = sum(1 for _ in clean.open())
        n_hard = sum(1 for _ in hard.open())
        n_unsolved = sum(1 for _ in unsolved.open())

        # 3 in, 3 out (no rows lost; decontam stub passes all)
        assert n_clean + n_hard + n_unsolved == 3, (
            f"expected 3 rows total, got clean={n_clean} hard={n_hard} "
            f"unsolved={n_unsolved}"
        )

        # With the mock plan above: p001 + p003 are TTT (clean), p002 is
        # TTF (hard). Asserting both buckets get traffic catches breaks
        # in the consensus-Judge / Vote / tag plumbing.
        assert n_clean >= 1, "no rows reached train_clean — Vote / judge_consensus broken?"
        assert n_hard >= 1, "no rows reached hard_disagreement — Judge.on_false broken?"

        # And the merged row must carry the per-model fields the verifier
        # set (catches JoinById regressions).
        import json
        with clean.open() as f:
            row = json.loads(f.readline())
        assert row["num_correct"] == 3
        assert row["ans_a"] and row["ans_b"] and row["ans_c"]
        assert row["correct_a"] and row["correct_b"] and row["correct_c"]
    finally:
        for p in (clean, hard, unsolved):
            p.unlink(missing_ok=True)

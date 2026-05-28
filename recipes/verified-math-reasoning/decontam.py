"""Decontamination: drop seed problems that appear in math benchmark test sets.

Compares the seed problem text against problems from MATH-500, GSM8K-test, and
AIME (via AI-MO's validation set). Uses two layers, both cheap:

1. **Exact match after normalization** — catches verbatim copies that differ
   only in whitespace, punctuation, casing, or LaTeX-whitespace commands.
2. **10-word shingle overlap** — catches paraphrases / re-typeset versions.
   Threshold `min_shingle_hits=3` shared shingles is a permissive setting:
   we'd rather drop a borderline seed than leak a benchmark question into
   training.

Benchmark corpora are downloaded from HuggingFace on first use and cached
under `.cache/` (gitignored). Cache lookups are in-process; re-import to
re-download.

Coverage is *not* research-grade — proper paraphrase contamination detection
needs an LLM-based check (Yang et al., "Rethinking Benchmark and
Contamination ... with Rephrased Samples", 2023). The function exposed here
catches the easy cases (exact copies, light paraphrases) and is honest
about its limits in the dataset README.
"""
from __future__ import annotations
import hashlib
import json
import re
import sys
import urllib.request
from functools import lru_cache
from pathlib import Path
from typing import Iterable, Iterator

CACHE = Path(__file__).resolve().parent / ".cache"


# (name, url, problem-field-name, format)
# Adding a benchmark: append a tuple and re-run; `lru_cache` is per-process
# so the next invocation rebuilds the index.
BENCHMARK_SOURCES: list[tuple[str, str, str, str]] = [
    ("math500",
     "https://huggingface.co/datasets/HuggingFaceH4/MATH-500/resolve/main/test.jsonl",
     "problem", "jsonl"),
    ("gsm8k_test",
     "https://huggingface.co/datasets/openai/gsm8k/resolve/main/main/test-00000-of-00001.parquet",
     "question", "parquet"),
    ("aime_validation",
     "https://huggingface.co/datasets/AI-MO/aimo-validation-aime/resolve/main/data/train-00000-of-00001.parquet",
     "problem", "parquet"),
]


_LATEX_SPACE_RE = re.compile(r"\\[,;:!]")     # \, \; \: \!
_PUNCT_RE = re.compile(r"[^\w\s]")
_WHITESPACE_RE = re.compile(r"\s+")


def _normalize(text: str) -> str:
    """Aggressive normalization for contamination matching."""
    s = text.lower()
    s = _LATEX_SPACE_RE.sub(" ", s)
    s = _PUNCT_RE.sub(" ", s)
    s = _WHITESPACE_RE.sub(" ", s).strip()
    return s


def _shingles(text: str, n: int = 10) -> set[str]:
    """Hashed n-word shingles (n=10 is the typical contam-detection setting:
    short enough to catch paraphrases, long enough to avoid false positives
    on phrases like 'find the value of x' that appear in every algebra
    book)."""
    words = _normalize(text).split()
    if len(words) < n:
        return set()
    return {
        hashlib.blake2b(" ".join(words[i:i + n]).encode(), digest_size=8).hexdigest()
        for i in range(len(words) - n + 1)
    }


def _download(url: str, target: Path) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    if target.exists():
        return
    tmp = target.with_suffix(target.suffix + ".part")
    urllib.request.urlretrieve(url, tmp)
    tmp.rename(target)


def _iter_problems(name: str, url: str, field: str, fmt: str) -> Iterator[str]:
    cache_file = CACHE / f"benchmark-{name}.{fmt}"
    try:
        _download(url, cache_file)
    except Exception as e:
        # Network-down / mirror moved: skip this benchmark with a loud
        # warning rather than crash the pipeline. The dataset card should
        # disclose which benchmarks were actually indexed.
        print(f"[decontam] WARN: failed to download {name}: {e}", file=sys.stderr)
        return
    if fmt == "jsonl":
        with cache_file.open() as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                row = json.loads(line)
                v = row.get(field)
                if isinstance(v, str):
                    yield v
    elif fmt == "parquet":
        try:
            import pyarrow.parquet as pq
        except ImportError:
            print(f"[decontam] WARN: pyarrow missing, skipping {name}", file=sys.stderr)
            return
        tbl = pq.read_table(cache_file, columns=[field])
        for v in tbl[field].to_pylist():
            if isinstance(v, str):
                yield v


@lru_cache(maxsize=1)
def _build_index() -> tuple[frozenset[str], frozenset[str]]:
    """Returns (normalized_problem_set, shingle_hash_set). Built once per
    process; `lru_cache` makes repeated calls free."""
    exacts: set[str] = set()
    shingles: set[str] = set()
    for name, url, field, fmt in BENCHMARK_SOURCES:
        n = 0
        for problem in _iter_problems(name, url, field, fmt):
            exacts.add(_normalize(problem))
            shingles.update(_shingles(problem))
            n += 1
        if n:
            print(f"[decontam] indexed {name}: {n} problems", file=sys.stderr)
    return frozenset(exacts), frozenset(shingles)


def in_test_benchmarks(problem: str, *, min_shingle_hits: int = 3) -> bool:
    """True if `problem` likely appears in a public math benchmark.

    Two-layer check:
      1) normalized-string equality with any benchmark problem
      2) >= `min_shingle_hits` shared 10-word shingles with the union of
         all benchmark problems

    Returns False on extremely short inputs (<10 words) where shingles
    aren't reliable; layer (1) still applies.
    """
    exacts, shingles = _build_index()
    if _normalize(problem) in exacts:
        return True
    seed_shingles = _shingles(problem)
    if not seed_shingles:
        return False
    return len(seed_shingles & shingles) >= min_shingle_hits


def index_stats() -> dict:
    """For dataset-card disclosure: how many benchmark problems / shingles
    the live decontam check is actually comparing against."""
    exacts, shingles = _build_index()
    return {"benchmark_problems": len(exacts), "shingle_hashes": len(shingles)}

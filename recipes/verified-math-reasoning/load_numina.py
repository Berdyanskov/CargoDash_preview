"""Convert NuminaMath-1.5 (HuggingFace) seeds into pipeline.py's SCHEMA jsonl.

NuminaMath-1.5 fields per row:
  problem, solution, answer, problem_type, question_type,
  problem_is_valid, solution_is_valid, source, synthetic

We keep only rows that are likely to verify cleanly:
  - problem_is_valid == "Yes" and solution_is_valid == "Yes"
  - question_type is not a proof / open-ended type
  - `answer` parses to a scalar (int / float / fraction) — gated by
    --scalar-only (default on; flip off once verifier handles symbolic
    answers)

Usage:
    python recipes/verified-math-reasoning/load_numina.py --out seeds.jsonl --limit 1000

Reads parquet directly via pyarrow (already a cargodash dep) — no need
to install the `datasets` library. Files are cached under .cache/.
"""
from __future__ import annotations
import argparse
import json
import sys
import urllib.request
from pathlib import Path
from typing import Iterator

import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).resolve().parent))
from verifier import _to_number  # noqa: E402  (local helper)


HERE = Path(__file__).resolve().parent
CACHE = HERE / ".cache"

PARQUET_URLS = [
    "https://huggingface.co/datasets/AI-MO/NuminaMath-1.5/resolve/main/data/train-00000-of-00003.parquet",
    "https://huggingface.co/datasets/AI-MO/NuminaMath-1.5/resolve/main/data/train-00001-of-00003.parquet",
    "https://huggingface.co/datasets/AI-MO/NuminaMath-1.5/resolve/main/data/train-00002-of-00003.parquet",
]

# question_type values we treat as "has a checkable numeric answer".
# Inspect the dataset card if more types should pass.
KEEP_QUESTION_TYPES = {"math-word-problem", "MCQ"}


def _cache_path(url: str) -> Path:
    return CACHE / url.rsplit("/", 1)[-1]


def _ensure_parquet(url: str) -> Path:
    p = _cache_path(url)
    if p.exists():
        return p
    CACHE.mkdir(parents=True, exist_ok=True)
    print(f"[load_numina] downloading {url} -> {p.name}", file=sys.stderr)
    tmp = p.with_suffix(p.suffix + ".part")
    urllib.request.urlretrieve(url, tmp)
    tmp.rename(p)
    return p


def _iter_rows(parquet_path: Path) -> Iterator[dict]:
    pf = pq.ParquetFile(parquet_path)
    for rg_idx in range(pf.num_row_groups):
        tbl = pf.read_row_group(rg_idx)
        for row in tbl.to_pylist():
            yield row


def _keep(row: dict, scalar_only: bool) -> bool:
    if row.get("problem_is_valid") != "Yes":
        return False
    if row.get("solution_is_valid") != "Yes":
        return False
    if row.get("question_type") not in KEEP_QUESTION_TYPES:
        return False
    ans = (row.get("answer") or "").strip()
    if not ans or ans.lower() == "proof":
        return False
    if scalar_only and _to_number(ans) is None:
        return False
    return True


def _to_seed_row(row: dict, idx: int) -> dict:
    src = row.get("source") or "numina"
    return {
        "id": f"numina-{src}-{idx:07d}",
        "source": f"numina:{src}",
        "problem": row["problem"].strip(),
        "reference_answer": row["answer"].strip(),
        "sol_a": "", "sol_b": "", "sol_c": "",
        "ans_a": "", "ans_b": "", "ans_c": "",
        "correct_a": False, "correct_b": False, "correct_c": False,
        "num_correct": 0,
        "difficulty": "",
        "split": "",
        # Seeds are NOT AI-generated (problem + reference_answer come from
        # NuminaMath-1.5). The flag flips to True at parse_and_verify time
        # once the row carries model-generated sol_a/b/c.
        "synthetic": False,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, required=True,
                    help="Output jsonl path")
    ap.add_argument("--limit", type=int, default=1000,
                    help="Max seed rows to emit (default 1000)")
    ap.add_argument("--shards", type=int, default=1,
                    help="How many of the 3 parquet shards to scan (default 1)")
    ap.add_argument("--no-scalar-only", action="store_true",
                    help="Keep rows whose answer isn't a parseable scalar "
                         "(useful once verifier handles symbolic answers)")
    args = ap.parse_args()

    scalar_only = not args.no_scalar_only
    args.out.parent.mkdir(parents=True, exist_ok=True)

    kept = 0
    scanned = 0
    seen_problems: set[str] = set()
    with args.out.open("w", encoding="utf-8") as fout:
        for url in PARQUET_URLS[: args.shards]:
            path = _ensure_parquet(url)
            for row in _iter_rows(path):
                scanned += 1
                if not _keep(row, scalar_only):
                    continue
                # Skeleton-level dedup: exact problem-text match across shards.
                # Production should use n-gram / minhash (DESIGN §5).
                key = row["problem"].strip()
                if key in seen_problems:
                    continue
                seen_problems.add(key)
                seed = _to_seed_row(row, kept)
                fout.write(json.dumps(seed, ensure_ascii=False))
                fout.write("\n")
                kept += 1
                if kept >= args.limit:
                    break
            if kept >= args.limit:
                break

    print(
        f"[load_numina] scanned={scanned} kept={kept} -> {args.out}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()

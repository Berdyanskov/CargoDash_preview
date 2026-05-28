"""Verifier sanity tests — pair-level + real NuminaMath."""
from __future__ import annotations
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from verifier import extract_boxed_or_number, numeric_equal


PAIRS_TRUE: list[tuple[str, str]] = [
    ("3", "3"),
    ("3.0", "3"),
    ("-3", "-3.0"),
    ("1/2", "0.5"),
    (r"\frac{1}{2}", "0.5"),
    (r"\dfrac{6}{2}", "3"),
    (r"\frac{6}{2}", "3.0"),
    (r"\sqrt{4}", "2"),
    (r"2\pi", "2*pi"),
    (r"\frac{\pi}{2}", "pi/2"),
]

# Boxed-extraction round-trip cases for unit-stripping.
EXTRACT_CASES: list[tuple[str, str]] = [
    # (raw LLM output, expected extraction)
    (r"... the angle is \boxed{45^\circ}.",            "45"),
    (r"answer: \boxed{45^{\circ}}.",                   "45"),
    (r"\boxed{45\circ}",                               "45"),
    (r"approximately \boxed{36.87^\circ}",             "36.87"),
    (r"\boxed{50\%} of the cells",                     "50"),
    (r"\boxed{50^\%}",                                 "50"),
    (r"\boxed{ 391 }",                                 "391"),
    (r"\boxed{45°}",                                   "45"),
    # Plain numeric should still pass through
    (r"\boxed{391}",                                   "391"),
    # No boxed -> fallback to last number
    (r"final: 17 * 23 = 391",                          "391"),
    # Nothing extractable
    (r"definitely no answer here",                     ""),
]

PAIRS_FALSE: list[tuple[str, str]] = [
    ("391", "390"),
    ("3", "4"),
    ("1/3", "0.5"),
    (r"\frac{1}{2}", "0.6"),
    (r"\sqrt{4}", "3"),
    ("", "0"),
    ("3", ""),
]


def main() -> None:
    fail = 0

    print("=== pair tests: should match ===")
    for a, b in PAIRS_TRUE:
        ok = numeric_equal(a, b)
        mark = "OK " if ok else "FAIL"
        print(f"  [{mark}] {a!r:30s} == {b!r}")
        if not ok:
            fail += 1

    print("\n=== pair tests: should NOT match ===")
    for a, b in PAIRS_FALSE:
        ok = not numeric_equal(a, b)
        mark = "OK " if ok else "FAIL"
        print(f"  [{mark}] {a!r:30s} != {b!r}")
        if not ok:
            fail += 1

    print("\n=== extract_boxed_or_number with units ===")
    for raw, expected in EXTRACT_CASES:
        got = extract_boxed_or_number(raw)
        ok = got == expected
        mark = "OK " if ok else "FAIL"
        print(f"  [{mark}] extract({raw!r:50s}) -> {got!r:>10s}  (want {expected!r})")
        if not ok:
            fail += 1

    # Real NuminaMath sanity: a model that writes "\boxed{<ref>}" should
    # produce a verifier "correct" verdict 100% of the time. Tests the
    # extract -> numeric_equal pipeline end-to-end.
    seeds_path = HERE / "_numina_1k.jsonl"
    if seeds_path.exists():
        print(f"\n=== NuminaMath round-trip: \\boxed{{ref}} -> verifier ===")
        n = 0
        misses: list[tuple[str, str, str]] = []
        with seeds_path.open() as f:
            for line in f:
                row = json.loads(line)
                ref = row["reference_answer"]
                synthetic_sol = f"Some reasoning. Therefore \\boxed{{{ref}}}."
                ext = extract_boxed_or_number(synthetic_sol)
                if not numeric_equal(ext, ref):
                    misses.append((row["id"], ref, ext))
                n += 1
        print(f"  scanned={n}  misses={len(misses)}  hit_rate={(n-len(misses))/n:.3%}")
        for mid, ref, ext in misses[:5]:
            print(f"  miss: id={mid}  ref={ref!r}  extracted={ext!r}")
        if misses:
            fail += 1

    print(f"\n{'PASS' if fail == 0 else f'{fail} FAIL(S)'}")
    sys.exit(fail)


if __name__ == "__main__":
    main()

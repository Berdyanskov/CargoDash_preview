"""Answer extraction + numeric equivalence for math CoT outputs.

Skeleton implementations: covers the GSM8K-style integer case and the
common `\\boxed{...}` competition format. Iterate as you hit edge cases
(intervals, vectors, units, equations).
"""
from __future__ import annotations
import re
from typing import Optional


_BOXED_RE = re.compile(r"\\boxed\{([^{}]*)\}")
_NUMBER_RE = re.compile(r"-?\d+(?:\.\d+)?(?:/\d+)?")

# Trailing units / LaTeX decorations that don't change the numeric value
# but defeat `numeric_equal` if left in. Order matters: longer / escaped
# forms first.
_UNIT_SUFFIXES: tuple[str, ...] = (
    r"^{\circ}", r"^\circ", r"\circ",
    r"\degrees", r"\degree",
    r"^{\%}", r"^\%", r"\%",
    "°", "%",
)


def _strip_units(s: str) -> str:
    """Remove trailing degree / percent / similar decorations from an
    already-extracted answer fragment. Whitespace-tolerant. Idempotent:
    repeatedly peel until no listed suffix remains, so `45^\\circ %` works.
    """
    prev = None
    while s and s != prev:
        prev = s
        s = s.strip().rstrip("$").strip()
        for suf in _UNIT_SUFFIXES:
            if s.endswith(suf):
                s = s[: -len(suf)].strip()
                break
    return s


def extract_boxed_or_number(text: str) -> str:
    """Pull the final answer out of a CoT response.

    Order: last `\\boxed{...}` wins; else last numeric literal in the text;
    else empty string. Empty return is treated as "extraction failed",
    which downstream maps to `correct_x = False`. Unit decorations on the
    boxed payload (`45^\\circ`, `20\\%`) are stripped so downstream
    `numeric_equal` can compare cleanly against a unit-free reference.
    """
    if not text:
        return ""
    boxed = _BOXED_RE.findall(text)
    if boxed:
        return _strip_units(boxed[-1])
    nums = _NUMBER_RE.findall(text)
    if nums:
        return nums[-1]
    return ""


def _to_number(s: str) -> Optional[float]:
    s = s.strip().rstrip(".")
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        pass
    if "/" in s:
        a, _, b = s.partition("/")
        try:
            return float(a) / float(b)
        except (ValueError, ZeroDivisionError):
            return None
    return None


def numeric_equal(a: str, b: str, tol: float = 1e-6) -> bool:
    """True if a and b denote the same number/expression (best-effort).

    Layered fast-to-slow:
      1) trivial string match (after strip)
      2) plain float / fraction parse  (handles "3" == "3.0", "1/2" == "0.5")
      3) sympy symbolic equivalence    (handles "\\frac{6}{2}" == "3",
                                        "2\\pi" == "2*pi", "\\sqrt{4}" == "2")
      4) normalized-string fallback
    """
    if a is None or b is None:
        return False
    a, b = a.strip(), b.strip()
    if not a or not b:
        return False
    if a == b:
        return True

    na, nb = _to_number(a), _to_number(b)
    if na is not None and nb is not None:
        return abs(na - nb) <= tol * max(1.0, abs(na), abs(nb))

    if _sympy_equal(a, b, tol):
        return True

    return _normalize_str(a) == _normalize_str(b)


def _normalize_str(s: str) -> str:
    return (
        s.replace(" ", "")
         .replace("$", "")
         .replace("\\dfrac", "\\frac")
         .replace("\\left", "")
         .replace("\\right", "")
    )


def _strip_boxed(s: str) -> str:
    s = s.strip()
    for prefix in (r"\boxed{", r"\boxed {"):
        if s.startswith(prefix) and s.endswith("}"):
            return s[len(prefix):-1]
    return s


# LaTeX -> sympy-friendly substitutions for the manual fallback path used
# when sympy's antlr-backed parse_latex is unavailable. Order matters:
# multi-char tokens before single-char.
_LATEX_REPLACEMENTS: tuple[tuple[str, str], ...] = (
    (r"\dfrac", r"\frac"),
    (r"\tfrac", r"\frac"),
    (r"\cdot", "*"),
    (r"\times", "*"),
    (r"\pi", "pi"),
    (r"\left", ""),
    (r"\right", ""),
    ("^", "**"),
)


def _latex_to_sympy_str(s: str) -> str:
    """Manual LaTeX-light normalizer for sympify when parse_latex isn't
    available. Handles \\frac{a}{b}, \\sqrt{x}, \\pi, ^, etc. Leaves
    unknown commands intact so sympify will reject them and we fall back."""
    import re
    s = _strip_boxed(s)
    for pat, repl in _LATEX_REPLACEMENTS:
        s = s.replace(pat, repl)
    s = re.sub(r"\\frac\{([^{}]*)\}\{([^{}]*)\}", r"((\1)/(\2))", s)
    s = re.sub(r"\\sqrt\{([^{}]*)\}", r"sqrt(\1)", s)
    s = s.replace("\\", "")
    return s.strip("{}")


def _to_sympy(s: str):
    """Best-effort: string -> sympy expression. Returns None on failure."""
    try:
        import sympy
        from sympy.parsing.sympy_parser import (
            parse_expr, standard_transformations,
            implicit_multiplication_application,
        )
    except ImportError:
        return None
    try:
        from sympy.parsing.latex import parse_latex
        return parse_latex(_strip_boxed(s))
    except Exception:
        pass
    # parse_expr w/ implicit multiplication handles "2pi", "3x", etc. that
    # plain sympify rejects. transformations is a small tuple — building
    # it on every call is fine.
    transformations = standard_transformations + (implicit_multiplication_application,)
    try:
        return parse_expr(_latex_to_sympy_str(s), transformations=transformations)
    except Exception:
        pass
    try:
        return sympy.sympify(s)
    except Exception:
        return None


def _sympy_equal(a: str, b: str, tol: float) -> bool:
    try:
        import sympy
    except ImportError:
        return False
    ea, eb = _to_sympy(a), _to_sympy(b)
    if ea is None or eb is None:
        return False
    try:
        diff = sympy.simplify(ea - eb)
        if diff == 0:
            return True
        d = float(diff.evalf())
        scale = max(1.0, abs(float(ea.evalf())), abs(float(eb.evalf())))
        return abs(d) <= tol * scale
    except Exception:
        return False


# Decontamination lives in its own module so the benchmark download /
# index-building lifecycle stays out of the verifier's hot path. Re-exported
# here for backward compat with existing imports.
from decontam import in_test_benchmarks  # noqa: E402,F401  (intentional re-export)

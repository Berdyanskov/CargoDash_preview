"""Schema backed by ``pyarrow.Schema``.

Why arrow as the backbone:
- Rich, well-defined type system (timestamps, decimals, lists, structs,
  fixed-size arrays) — beats hand-rolled type tags.
- Future interop with parquet / polars / pandas / arrow IPC for free
  when we move from list-of-dict batches to columnar batches.

What we expose on top of ``pa.Schema``:
- ``Schema.of(name=type, ...)`` accepts plain python types for the
  common cases (int / float / str / bool / bytes), and also accepts
  raw ``pa.DataType`` / ``pa.Field`` for everything else. This keeps
  the user-facing API short.
- ``validate_row`` does a python-side per-field isinstance check.
  Cheap and good enough until rows themselves become arrow-backed.
- Equality is delegated to ``pa.Schema.equals``.
"""
from __future__ import annotations
from typing import Mapping, Union

import pyarrow as pa


# Plain python types users will hit 99% of the time.
_PY_TO_PA: dict[type, pa.DataType] = {
    int: pa.int64(),
    float: pa.float64(),
    str: pa.string(),
    bool: pa.bool_(),
    bytes: pa.binary(),
}

FieldSpec = Union[type, pa.DataType, pa.Field]


def _to_pa_field(name: str, spec: FieldSpec) -> pa.Field:
    if isinstance(spec, pa.Field):
        return spec if spec.name == name else spec.with_name(name)
    if isinstance(spec, pa.DataType):
        return pa.field(name, spec)
    if isinstance(spec, type):
        if spec not in _PY_TO_PA:
            raise TypeError(
                f"field '{name}': python type {spec.__name__} has no default "
                f"arrow mapping; pass a pa.DataType explicitly"
            )
        return pa.field(name, _PY_TO_PA[spec])
    raise TypeError(
        f"field '{name}': spec must be a python type, pa.DataType, or pa.Field; "
        f"got {spec!r}"
    )


def _pa_to_py(dtype: pa.DataType) -> type:
    """Best-effort arrow-type -> python-type for isinstance checks."""
    if pa.types.is_boolean(dtype):
        return bool
    if pa.types.is_integer(dtype):
        return int
    if pa.types.is_floating(dtype):
        return float
    if pa.types.is_string(dtype) or pa.types.is_large_string(dtype):
        return str
    if pa.types.is_binary(dtype) or pa.types.is_large_binary(dtype) or pa.types.is_fixed_size_binary(dtype):
        return bytes
    if pa.types.is_list(dtype) or pa.types.is_large_list(dtype) or pa.types.is_fixed_size_list(dtype):
        return list
    if pa.types.is_struct(dtype) or pa.types.is_map(dtype):
        return dict
    return object  # unknown -> skip the python-side check


class Schema:
    """Thin wrapper around ``pa.Schema`` with row-dict validation helpers."""

    __slots__ = ("arrow", "_py_types")

    def __init__(self, arrow: pa.Schema):
        self.arrow = arrow
        # Pre-compute python types for fast row validation.
        self._py_types: tuple[tuple[str, type], ...] = tuple(
            (f.name, _pa_to_py(f.type)) for f in arrow
        )

    @classmethod
    def of(cls, **fields: FieldSpec) -> "Schema":
        """Build a schema from kwargs. Accepts python types, pa.DataType, or pa.Field."""
        pa_fields = [_to_pa_field(name, spec) for name, spec in fields.items()]
        return cls(arrow=pa.schema(pa_fields))

    @classmethod
    def from_arrow(cls, arrow_schema: pa.Schema) -> "Schema":
        return cls(arrow=arrow_schema)

    @property
    def field_names(self) -> tuple[str, ...]:
        return tuple(self.arrow.names)

    def validate_row(self, row: Mapping) -> None:
        for name, py_type in self._py_types:
            if name not in row:
                raise ValueError(f"row missing field '{name}'")
            if py_type is not object and not isinstance(row[name], py_type):
                raise TypeError(
                    f"field '{name}': expected {py_type.__name__}, "
                    f"got {type(row[name]).__name__}"
                )

    def is_compatible_with(self, other: "Schema") -> bool:
        return self.arrow.equals(other.arrow)

    def __eq__(self, other: object) -> bool:
        return isinstance(other, Schema) and self.arrow.equals(other.arrow)

    def __hash__(self) -> int:
        # pa.Schema isn't hashable; build a stable surrogate.
        return hash(tuple((f.name, str(f.type)) for f in self.arrow))

    def __repr__(self) -> str:
        sig = ", ".join(f"{f.name}: {f.type}" for f in self.arrow)
        return f"Schema({sig})"

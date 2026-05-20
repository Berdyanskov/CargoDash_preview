"""Pipeline: walks the DAG from one or more sources, validates schema, runs it."""
from __future__ import annotations
from typing import Iterable, Iterator, List, Union

from .module import Module


class Pipeline:
    def __init__(self, source: Union[Module, Iterable[Module]]):
        if isinstance(source, Module):
            self.sources: List[Module] = [source]
        else:
            self.sources = list(source)
            if not self.sources:
                raise ValueError("Pipeline requires at least one source module")
            for s in self.sources:
                if not isinstance(s, Module):
                    raise TypeError(
                        f"Pipeline source must be a Module, got {type(s).__name__}"
                    )
        self.nodes: List[Module] = self._collect_nodes(self.sources)
        self._validate_schemas()

    @staticmethod
    def _collect_nodes(sources: List[Module]) -> List[Module]:
        seen: list[Module] = []
        seen_ids: set[int] = set()
        stack: list[Module] = list(sources)
        while stack:
            node = stack.pop()
            if id(node) in seen_ids:
                continue
            seen_ids.add(id(node))
            seen.append(node)
            for downstreams in node._downstreams.values():
                stack.extend(downstreams)
        return seen

    def _validate_schemas(self) -> None:
        # For every edge, src.output_schema must be compatible with
        # dst.input_schema (when both are declared).
        # For convergence (multiple upstreams -> one downstream), all
        # upstreams must declare equivalent output_schema.
        upstream_out_by_dst: dict[int, list] = {}
        for src in self.nodes:
            for port, dsts in src._downstreams.items():
                for dst in dsts:
                    if (src.output_schema is not None
                            and dst.input_schema is not None
                            and not src.output_schema.is_compatible_with(dst.input_schema)):
                        raise TypeError(
                            f"schema mismatch: {src.name}.{port} -> {dst.name}\n"
                            f"  src.output_schema = {src.output_schema}\n"
                            f"  dst.input_schema  = {dst.input_schema}"
                        )
                    upstream_out_by_dst.setdefault(id(dst), []).append(
                        (src, src.output_schema)
                    )
        for dst_id, srcs in upstream_out_by_dst.items():
            schemas = [s for _, s in srcs if s is not None]
            if len(schemas) > 1 and any(s != schemas[0] for s in schemas[1:]):
                names = ", ".join(src.name for src, _ in srcs)
                raise TypeError(
                    f"convergence schema mismatch into a single downstream "
                    f"from upstreams: [{names}]"
                )

    def run(self) -> None:
        # Lazy import so `core` doesn't depend on `runtime` / `models`.
        from ..runtime.executor import Executor

        clients = self._collect_clients()
        opened: list = []
        try:
            for client in clients:
                # Any failure here (OOM, vllm not installed, port in use,
                # readiness timeout) propagates up — pipeline never starts.
                client.open()
                opened.append(client)
            Executor().run(self)
        finally:
            # LIFO close. Don't let cleanup errors mask an earlier failure;
            # report them on stderr instead.
            for client in reversed(opened):
                try:
                    client.close()
                except BaseException as e:  # noqa: BLE001
                    import sys
                    print(
                        f"[cargodash] error closing {type(client).__name__}: {e}",
                        file=sys.stderr,
                    )

    # -- client lifecycle helpers --------------------------------------------

    def _collect_clients(self) -> list:
        """Return a deduplicated list of every ``ChatClient`` reachable
        from the DAG. Walks each node's ``fn`` attribute, descending
        through ``LLMCall.client`` and ``Vote.models`` items. Dedup is
        by object identity so the same client referenced from multiple
        nodes / multiple Vote slots is opened exactly once."""
        from ..models.client import ChatClient
        seen: dict[int, ChatClient] = {}
        for node in self.nodes:
            for client in _walk_clients(getattr(node, "fn", None)):
                seen.setdefault(id(client), client)
        return list(seen.values())


def _walk_clients(obj) -> Iterator:
    """Best-effort traversal: yield every ``ChatClient`` reachable from
    ``obj`` via known attribute names. Kept structural rather than
    type-name-dependent so user-supplied wrappers can also expose a
    ``.client`` or ``.models`` and be picked up.
    """
    from ..models.client import ChatClient
    if obj is None:
        return
    if isinstance(obj, ChatClient):
        yield obj
        return
    client = getattr(obj, "client", None)
    if isinstance(client, ChatClient):
        yield client
    models = getattr(obj, "models", None)
    if models is not None:
        try:
            iterator = iter(models)
        except TypeError:
            return
        for m in iterator:
            yield from _walk_clients(m)

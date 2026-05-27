"""Chat-style LLM client abstraction.

A ``ChatClient`` is a thin transport: take an OpenAI-style messages list,
return the assistant's reply text. Concrete implementations:

- ``OpenAICompatChatClient``: covers OpenAI itself plus any vendor that
  speaks the OpenAI-compatible chat-completions API (DeepSeek, Moonshot,
  Zhipu, vLLM, SGLang, Ollama, ...). Just point ``base_url`` at them.
- ``MockChatClient``: for examples and tests; no network.

Retry: ``OpenAICompatChatClient`` retries transient failures (rate limit,
timeout, connection error, 5xx) with jittered exponential backoff. The
SDK's own retry is disabled to avoid double-retry; exhausted calls either
return an empty string (default — composes with the verifier-friendly
"empty output = wrong answer" pattern) or re-raise the last exception
(``on_exhaust="raise"``).
"""
from __future__ import annotations
import logging
import random
import time
from abc import ABC, abstractmethod
from typing import Any, Callable, List, Literal, Mapping, Optional, Tuple, Type, TypeVar


Messages = List[Mapping[str, str]]   # [{"role": "system"|"user"|"assistant", "content": str}, ...]

T = TypeVar("T")

logger = logging.getLogger("cargodash.client")


def _retry_call(
    fn: Callable[[], T],
    *,
    max_retries: int,
    retry_on: Tuple[Type[BaseException], ...],
    backoff_base: float,
    backoff_max: float,
    jitter: float,
    sleep: Callable[[float], None] = time.sleep,
    on_log: Optional[Callable[[str], None]] = None,
) -> T:
    """Call ``fn()``; retry on listed exceptions up to ``max_retries`` extra
    times with jittered exponential backoff. Non-listed exceptions are
    re-raised immediately. After the last attempt fails, the final
    exception is re-raised.

    ``max_retries`` is **additional** attempts beyond the initial one, so
    ``max_retries=5`` yields up to 6 total attempts. ``sleep`` is
    injectable so tests can run without real wall-clock waits.

    Backoff schedule: ``min(backoff_base * 2**attempt, backoff_max) +
    uniform(0, jitter)``. The jitter de-correlates retries when many
    workers hit the same rate limit simultaneously (DataFlow's retry
    loops lack this and tend to thunder).
    """
    last_exc: Optional[BaseException] = None
    for attempt in range(max_retries + 1):
        try:
            return fn()
        except retry_on as e:
            last_exc = e
            if attempt >= max_retries:
                break
            delay = min(backoff_base * (2 ** attempt), backoff_max)
            if jitter > 0:
                delay += random.uniform(0, jitter)
            msg = (
                f"retryable error (attempt {attempt + 1}/{max_retries + 1}): "
                f"{type(e).__name__}: {e}; sleeping {delay:.2f}s"
            )
            (on_log or logger.warning)(msg)
            sleep(delay)
    assert last_exc is not None
    raise last_exc


class ChatClient(ABC):
    """Single-turn or multi-turn chat transport.

    Concrete implementations must be **thread-safe**: the executor will
    call ``chat`` concurrently from multiple worker threads when a
    Processor sets ``intra_batch_workers > 1``.

    Lifecycle: ``Pipeline.run()`` calls ``open()`` on every client used
    by the graph before any executor thread starts, and ``close()`` after
    the executor finishes (in a ``finally``). Clients that allocate heavy
    resources (loading a model, spawning a vLLM subprocess) should do it
    in ``open()`` so a failure surfaces *before* the pipeline starts —
    not in the middle of a run. Defaults are no-ops; cheap network clients
    do not need to override.
    """

    def open(self) -> None:  # noqa: A003 - mirrors file-like API
        pass

    def close(self) -> None:
        pass

    @abstractmethod
    def chat(self, messages: Messages, **gen_kwargs: Any) -> str:
        ...


def _default_retryable_excs() -> Tuple[Type[BaseException], ...]:
    """Resolve the default retryable exception set from the openai SDK.

    Lazily imported so cargodash itself doesn't hard-depend on openai;
    only callers of ``OpenAICompatChatClient`` ever reach this.
    """
    import openai  # noqa: PLC0415  - lazy by design
    return (
        openai.RateLimitError,
        openai.APITimeoutError,
        openai.APIConnectionError,
        openai.InternalServerError,    # 500
    )


class OpenAICompatChatClient(ChatClient):
    def __init__(
        self,
        model: str,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: float = 60.0,
        *,
        max_retries: int = 5,
        retry_on: Optional[Tuple[Type[BaseException], ...]] = None,
        backoff_base: float = 1.0,
        backoff_max: float = 30.0,
        jitter: float = 0.5,
        on_exhaust: Literal["return_empty", "raise"] = "return_empty",
    ):
        """OpenAI-compatible chat client with native retry.

        Retry parameters:
            max_retries: additional retries after the initial attempt
                (``max_retries=5`` => up to 6 attempts total). Default 5
                matches DataFlow's APILLMServing_request convention.
            retry_on: exception classes that count as "transient". Default
                pulls ``RateLimitError`` / ``APITimeoutError`` /
                ``APIConnectionError`` / ``InternalServerError`` from the
                openai SDK. Pass an explicit tuple to override (e.g. to
                include custom proxy errors).
            backoff_base / backoff_max: exponential backoff is
                ``min(base * 2**attempt, max) + uniform(0, jitter)``.
            jitter: uniform-random jitter seconds added to each backoff;
                de-correlates retries across concurrent workers hit by the
                same rate limit. Set 0 to disable.
            on_exhaust: behavior after retries are exhausted —
                ``"return_empty"`` (default) returns ``""`` so the pipeline
                continues with a row whose downstream verifier will mark
                it wrong; ``"raise"`` re-raises the last exception and
                bubbles to the executor (stops the run).
        """
        # Lazy import so cargodash itself doesn't hard-depend on the openai SDK.
        try:
            from openai import OpenAI
        except ImportError as e:
            raise ImportError(
                "OpenAICompatChatClient requires the `openai` package. "
                "Install it with `pip install openai`."
            ) from e
        if on_exhaust not in ("return_empty", "raise"):
            raise ValueError(
                f"on_exhaust must be 'return_empty' or 'raise', got {on_exhaust!r}"
            )
        if max_retries < 0:
            raise ValueError(f"max_retries must be >= 0, got {max_retries}")

        self.model = model
        # Disable SDK-level retry: we own the retry loop. Double-retry
        # would compound waits exponentially.
        self._client = OpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=timeout,
            max_retries=0,
        )
        self._max_retries = max_retries
        self._retry_on = retry_on if retry_on is not None else _default_retryable_excs()
        self._backoff_base = backoff_base
        self._backoff_max = backoff_max
        self._jitter = jitter
        self._on_exhaust = on_exhaust

    def chat(self, messages: Messages, **gen_kwargs: Any) -> str:
        def _do_call() -> str:
            resp = self._client.chat.completions.create(
                model=self.model,
                messages=list(messages),
                **gen_kwargs,
            )
            return resp.choices[0].message.content or ""

        try:
            return _retry_call(
                _do_call,
                max_retries=self._max_retries,
                retry_on=self._retry_on,
                backoff_base=self._backoff_base,
                backoff_max=self._backoff_max,
                jitter=self._jitter,
            )
        except self._retry_on as e:
            # Exhausted: classify by on_exhaust.
            logger.error(
                "chat() exhausted %d retries (model=%s): %s: %s",
                self._max_retries, self.model, type(e).__name__, e,
            )
            if self._on_exhaust == "raise":
                raise
            return ""


class MockChatClient(ChatClient):
    """Returns canned responses. Useful for examples, unit tests, and
    cost-free dry runs of a pipeline graph."""

    def __init__(
        self,
        response_fn: Optional[Callable[[Messages], str]] = None,
        fixed_response: str = "[mock-response]",
    ):
        self.response_fn = response_fn
        self.fixed_response = fixed_response

    def chat(self, messages: Messages, **gen_kwargs: Any) -> str:
        if self.response_fn is not None:
            return self.response_fn(messages)
        return self.fixed_response

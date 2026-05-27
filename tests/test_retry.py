"""Tests for the retry layer in cargodash.models.client."""
from __future__ import annotations
import pytest

from cargodash.models.client import _retry_call, OpenAICompatChatClient


class TransientError(Exception):
    pass


class FatalError(Exception):
    pass


def _no_sleep(_seconds: float) -> None:
    """Drop-in for time.sleep so tests don't actually wait."""
    return None


# -- _retry_call (the pure helper) -----------------------------------------

def test_succeeds_on_first_try():
    calls = []

    def fn():
        calls.append(1)
        return "ok"

    out = _retry_call(
        fn, max_retries=3, retry_on=(TransientError,),
        backoff_base=0, backoff_max=0, jitter=0, sleep=_no_sleep,
    )
    assert out == "ok"
    assert len(calls) == 1


def test_recovers_on_third_try():
    calls = []

    def fn():
        calls.append(1)
        if len(calls) < 3:
            raise TransientError(f"flaky {len(calls)}")
        return "ok"

    out = _retry_call(
        fn, max_retries=5, retry_on=(TransientError,),
        backoff_base=0, backoff_max=0, jitter=0, sleep=_no_sleep,
    )
    assert out == "ok"
    assert len(calls) == 3


def test_exhausts_and_raises_last():
    calls = []

    def fn():
        calls.append(1)
        raise TransientError(f"fail {len(calls)}")

    with pytest.raises(TransientError, match="fail 4"):
        _retry_call(
            fn, max_retries=3, retry_on=(TransientError,),
            backoff_base=0, backoff_max=0, jitter=0, sleep=_no_sleep,
        )
    # max_retries=3 => 4 total attempts (1 initial + 3 retries)
    assert len(calls) == 4


def test_non_retryable_raised_immediately():
    calls = []

    def fn():
        calls.append(1)
        raise FatalError("nope")

    with pytest.raises(FatalError):
        _retry_call(
            fn, max_retries=5, retry_on=(TransientError,),
            backoff_base=0, backoff_max=0, jitter=0, sleep=_no_sleep,
        )
    assert len(calls) == 1   # no retries on non-listed exception


def test_backoff_schedule_respects_cap_and_jitter():
    """Backoff must be monotonic up to cap, with jitter inside [0, jitter_max]."""
    sleeps: list[float] = []
    calls = []

    def fn():
        calls.append(1)
        raise TransientError("x")

    # base=1, max=4, no jitter -> expected delays: 1, 2, 4, 4 (capped)
    with pytest.raises(TransientError):
        _retry_call(
            fn, max_retries=4, retry_on=(TransientError,),
            backoff_base=1.0, backoff_max=4.0, jitter=0.0,
            sleep=sleeps.append,
        )
    assert sleeps == [1.0, 2.0, 4.0, 4.0]
    assert len(calls) == 5

    # with jitter=0.5, delays should be in [expected, expected + 0.5)
    sleeps.clear()
    calls.clear()
    with pytest.raises(TransientError):
        _retry_call(
            fn, max_retries=4, retry_on=(TransientError,),
            backoff_base=1.0, backoff_max=4.0, jitter=0.5,
            sleep=sleeps.append,
        )
    base_expected = [1.0, 2.0, 4.0, 4.0]
    for actual, expected in zip(sleeps, base_expected):
        assert expected <= actual < expected + 0.5


def test_multiple_retry_classes():
    """retry_on accepts a tuple; any listed class triggers retry."""
    class TimeoutLike(Exception):
        pass

    class RateLimitLike(Exception):
        pass

    seq = iter([TimeoutLike("t"), RateLimitLike("r"), "ok"])

    def fn():
        nxt = next(seq)
        if isinstance(nxt, Exception):
            raise nxt
        return nxt

    out = _retry_call(
        fn, max_retries=5, retry_on=(TimeoutLike, RateLimitLike),
        backoff_base=0, backoff_max=0, jitter=0, sleep=_no_sleep,
    )
    assert out == "ok"


# -- OpenAICompatChatClient integration ------------------------------------

@pytest.fixture
def fake_openai_module(monkeypatch):
    """Stub the openai package so OpenAICompatChatClient can be constructed
    without the SDK actually doing anything. Yields a recorder dict the
    test can poke to control behavior."""
    import sys
    import types

    state = {
        "responses": [],     # list[Exception | str]: popped on each call
        "calls": [],         # records of (model, messages) on each attempt
    }

    class _FakeChoice:
        def __init__(self, content):
            self.message = types.SimpleNamespace(content=content)

    class _FakeResp:
        def __init__(self, content):
            self.choices = [_FakeChoice(content)]

    class _Completions:
        def create(self, *, model, messages, **kw):
            state["calls"].append((model, messages))
            nxt = state["responses"].pop(0)
            if isinstance(nxt, BaseException):
                raise nxt
            return _FakeResp(nxt)

    class _Chat:
        completions = _Completions()

    class _FakeClient:
        def __init__(self, **kw):
            state["client_kwargs"] = kw
            self.chat = _Chat()

    class _RateLimitError(Exception): pass
    class _APITimeoutError(Exception): pass
    class _APIConnectionError(Exception): pass
    class _InternalServerError(Exception): pass

    fake_openai = types.ModuleType("openai")
    fake_openai.OpenAI = _FakeClient
    fake_openai.RateLimitError = _RateLimitError
    fake_openai.APITimeoutError = _APITimeoutError
    fake_openai.APIConnectionError = _APIConnectionError
    fake_openai.InternalServerError = _InternalServerError

    monkeypatch.setitem(sys.modules, "openai", fake_openai)
    state["exc"] = fake_openai
    yield state


def test_client_retries_on_default_retryable(fake_openai_module, monkeypatch):
    monkeypatch.setattr("cargodash.models.client.time.sleep", _no_sleep)
    fake_openai_module["responses"] = [
        fake_openai_module["exc"].RateLimitError("slow down"),
        fake_openai_module["exc"].APITimeoutError("timed out"),
        "recovered",
    ]
    client = OpenAICompatChatClient(model="x", api_key="k", max_retries=5, jitter=0)
    out = client.chat([{"role": "user", "content": "hi"}])
    assert out == "recovered"
    assert len(fake_openai_module["calls"]) == 3


def test_client_on_exhaust_return_empty(fake_openai_module, monkeypatch):
    monkeypatch.setattr("cargodash.models.client.time.sleep", _no_sleep)
    fake_openai_module["responses"] = [
        fake_openai_module["exc"].RateLimitError("fail") for _ in range(10)
    ]
    client = OpenAICompatChatClient(model="x", api_key="k", max_retries=3, jitter=0,
                                     on_exhaust="return_empty")
    out = client.chat([{"role": "user", "content": "hi"}])
    assert out == ""
    assert len(fake_openai_module["calls"]) == 4   # 1 initial + 3 retries


def test_client_on_exhaust_raise(fake_openai_module, monkeypatch):
    monkeypatch.setattr("cargodash.models.client.time.sleep", _no_sleep)
    exc_cls = fake_openai_module["exc"].RateLimitError
    fake_openai_module["responses"] = [exc_cls(f"fail{i}") for i in range(5)]
    client = OpenAICompatChatClient(model="x", api_key="k", max_retries=2, jitter=0,
                                     on_exhaust="raise")
    with pytest.raises(exc_cls):
        client.chat([{"role": "user", "content": "hi"}])
    assert len(fake_openai_module["calls"]) == 3


def test_client_does_not_retry_non_retryable(fake_openai_module, monkeypatch):
    monkeypatch.setattr("cargodash.models.client.time.sleep", _no_sleep)
    fake_openai_module["responses"] = [ValueError("malformed input")]
    client = OpenAICompatChatClient(model="x", api_key="k", max_retries=5, jitter=0)
    with pytest.raises(ValueError):
        client.chat([{"role": "user", "content": "hi"}])
    assert len(fake_openai_module["calls"]) == 1


def test_client_disables_sdk_retry(fake_openai_module):
    OpenAICompatChatClient(model="x", api_key="k", max_retries=3)
    # We explicitly set max_retries=0 on the OpenAI() client to avoid
    # double-retry compounding waits.
    assert fake_openai_module["client_kwargs"]["max_retries"] == 0


def test_client_rejects_bad_args(fake_openai_module):
    with pytest.raises(ValueError):
        OpenAICompatChatClient(model="x", api_key="k", on_exhaust="bogus")
    with pytest.raises(ValueError):
        OpenAICompatChatClient(model="x", api_key="k", max_retries=-1)

# Changelog

All notable changes to CargoDash are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
As of v1.0.0, CargoDash follows [Semantic Versioning](https://semver.org/): the
public API exported from `cargodash/__init__.py` is stable within a major
version, and breaking changes are reserved for the next major release.

## [1.0.6] - 2026-05-28

### Added
- **`OpenAICompatChatClient` native retry**: jittered exponential backoff
  (`max_retries=5` default, `backoff_base=1`, `backoff_max=30`, `jitter=0.5`)
  with an explicit `retry_on` exception set defaulting to OpenAI SDK's
  `RateLimitError` / `APITimeoutError` / `APIConnectionError` /
  `InternalServerError`. Non-listed exceptions (e.g. `PermissionDeniedError`)
  are re-raised immediately. Exhausted calls behave per `on_exhaust`:
  `"return_empty"` (default — returns `""` so downstream verifiers mark the
  row wrong and the pipeline keeps streaming) or `"raise"`. The SDK's own
  retry is disabled to avoid double-retry compounding.
- **`OpenAICompatChatClient.include_reasoning`** (default `True`): when the
  response message exposes a `reasoning_content` field (DeepSeek-R1,
  GLM-4.5/5.x, Doubao-seed, Moonshot-thinking, …), it's appended to
  `content`; if `content` is empty because the model exhausted `max_tokens`
  while thinking, the reasoning text is returned alone so the row still
  carries a `\boxed{}` candidate for the extractor.
- **`JoinById` operator** (`cargodash.JoinById`): stateful fan-in merger.
  Buffers partial rows by `key=...`, emits the merged row once `expected`
  upstreams have reported — **counted by contribution, not by field
  truthiness**, so a model returning empty content doesn't deadlock the
  buffer. Pairs naturally with multi-model fan-out (`source >> gen_a;
  source >> gen_b; gen_a >> join; gen_b >> join`).
- **Flagship recipe `recipes/verified-math-reasoning/`**: 3-model fan-out
  (DeepSeek + Doubao + Qwen3.5) → program-verified `\boxed{}` extraction →
  3-way split (`train_clean` / `hard_disagreement` / `unsolved_flagged`).
  Pipeline is ~180 lines in the canonical 8-section layout; v0.1 dataset
  ships with 999 verified rows derived from 1000 NuminaMath olympiad
  seeds (524 / 312 / 163 across the three splits after dropping 1 row
  flagged by `decontam.py` as overlapping MATH-500; all `sol_a/b/c`
  non-empty, 13 retries / 0 exhausted in the 3h39m production run).
- **`recipes/verified-math-reasoning/decontam.py`**: two-layer
  decontamination — normalized exact-match plus ≥3 shared 10-word
  shingles — against MATH-500 + GSM8K-test + AIME-validation (1909
  benchmark problems, ~70k shingles). First-use download cached under
  `.cache/`. Replaces the one-string placeholder in `verifier.py`.

### Fixed
- `cargodash/__init__.py` re-exports `JoinById` (P0 step toward the
  built-in operator library promised in `plan.md`).

## [1.0.5] - 2026-05-23

### Added
- Agent skills under `skills/` to make CargoDash Agent-friendly: a shared
  `cargodash-reference` (authoritative API + semantics), `cargodash-fill-pipeline`
  (complete the blank node functions in a WebUI-scaffolded `.cdgraph.json` /
  `pipeline.py`), and `cargodash-from-scratch` (build a runnable pipeline from a
  natural-language description). No library API change.

## [1.0.0] - 2026-05-17

First stable release. The public API is now covered by a SemVer compatibility
guarantee.

### Added
- Test suite under `tests/` (stdlib `unittest`), covering `Schema`, graph
  construction, pipeline schema validation, `Processor` / `Judge` / `Vote`,
  `LLMCall`, and end-to-end executor runs. Run with
  `python -m unittest discover -s tests`.
- GitHub Actions CI (`.github/workflows/ci.yml`): runs the test suite on
  Python 3.10 / 3.11 / 3.12 for every push and pull request.
- `dev` optional-dependency group (`pip install -e ".[dev]"`) pulling in
  `pytest`.

### Changed
- The package version is now single-sourced from `cargodash/__init__.py`
  (`__version__`) and read dynamically by the build backend, replacing the
  hard-coded value previously duplicated in `pyproject.toml`.

## [0.2.3]

### Changed
- WebUI: dev-server config adapted for editor-port-forwarded remote-server
  access — `base: './'` for relative asset URLs, `server.allowedHosts: true`
  to bypass the Vite 5.x Host-header check, and a new `preview` config block
  mirroring `server` so `npm run build && npm run preview` is reachable
  through subpath proxies.

## [0.2.2]

### Added
- Local model deployment: `LocalHFChatClient` (in-process `transformers`) and
  `LocalVLLMChatClient` (CargoDash-managed `vllm serve` subprocess, reaped on
  exit). Clients are opened up-front and shared by object identity across
  referencing nodes, so a model is never loaded twice.
- `ChatClient.open()` / `close()` lifecycle hooks.
- WebUI: `ModelSpec` floating node — declare a model once and reference it
  from `LLMCall`; codegen emits a single top-level client singleton.

## [0.2.1]

### Added
- WebUI visual pipeline editor: drag nodes onto a canvas, wire them up, fill
  in parameters, and export `pipeline.py` in one click.

## [0.2.0]

### Added
- `LLMCall`: one-line LLM nodes from `prompt + model + api_key`, usable as the
  `fn` of a sample-mode `Processor`.
- `ChatClient` protocol layer: `ChatClient` / `OpenAICompatChatClient` /
  `MockChatClient`.

### Changed
- `Processor` collapsed into a single class with `mode="sample"` (default) /
  `mode="batch"`, merging in the former `MapProcessor`.

### Fixed
- Execution fault tolerance: when any node raises, the executor now guarantees
  SENTINEL propagation to all downstreams and switches entry queues to drain
  mode — no more cascading deadlock. The original error is re-raised verbatim.

[1.0.6]: https://github.com/Berdyanskov/CargoDash/releases/tag/v1.0.6
[1.0.5]: https://github.com/Berdyanskov/CargoDash/releases/tag/v1.0.5
[1.0.0]: https://github.com/Berdyanskov/CargoDash/releases/tag/v1.0.0
[0.2.3]: https://github.com/Berdyanskov/CargoDash/releases/tag/v0.2.3
[0.2.2]: https://github.com/Berdyanskov/CargoDash/releases/tag/v0.2.2
[0.2.1]: https://github.com/Berdyanskov/CargoDash/releases/tag/v0.2.1
[0.2.0]: https://github.com/Berdyanskov/CargoDash/releases/tag/v0.2.0

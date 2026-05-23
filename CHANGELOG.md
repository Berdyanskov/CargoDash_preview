# Changelog

All notable changes to CargoDash are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
As of v1.0.0, CargoDash follows [Semantic Versioning](https://semver.org/): the
public API exported from `cargodash/__init__.py` is stable within a major
version, and breaking changes are reserved for the next major release.

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

[1.0.5]: https://github.com/Berdyanskov/CargoDash_preview/releases/tag/v1.0.5
[1.0.0]: https://github.com/Berdyanskov/CargoDash_preview/releases/tag/v1.0.0
[0.2.3]: https://github.com/Berdyanskov/CargoDash_preview/releases/tag/v0.2.3
[0.2.2]: https://github.com/Berdyanskov/CargoDash_preview/releases/tag/v0.2.2
[0.2.1]: https://github.com/Berdyanskov/CargoDash_preview/releases/tag/v0.2.1
[0.2.0]: https://github.com/Berdyanskov/CargoDash_preview/releases/tag/v0.2.0

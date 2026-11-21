# Changelog

All notable changes to this project are documented here. The format is [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- The licence gate could not see **LGPL**: the pattern only matched `GPL`/`AGPL`, so `LGPL-2.1-or-later` inside a
  compound `MIT AND LGPL-2.1-or-later` string passed silently. It now matches `GPL`, `AGPL` and `LGPL`, and
  `--strict` ignores the allowlist so the difference between "no copyleft" and "one examined exception" is visible.

### Security

- One copyleft dependency is examined and allowed: `@opentui/core-*` statically links a decode-only FFmpeg 9.0.2 built
  with GPL and non-free parts disabled. It is installed from npm rather than redistributed, and the dylib is never
  baked into our build output. Reasoning in
  [ARCHITECTURE.md](ARCHITECTURE.md#5-licence--scriptscheck-licencests).

### Added

- Repo scaffold: MIT licence, `package.json` with `bunx` entry and the `dev`/`build`/`test`/`lint`/`check:*` scripts,
  strict `tsconfig.json`, `.editorconfig`, `.gitignore` that keeps engine binaries and `*.wasm` out of the tree.
- `scripts/check-licences.ts` — walks the dependency tree and fails the build on any copyleft licence, so a GPL package
  cannot reach the published artefact. `check:licences:strict` ignores the allowlist and must pass before a release.
- `README.md`, `docs/PLAN.md`, `docs/TODO.md`, `docs/ARCHITECTURE.md`, `CONTRIBUTING.md`.
- Rendered design reference at `relics/tokenmate-design/index.html`: boxed 4×3 board, five skins, the level ladder.

## [0.1.0] — unreleased

First release. Nothing here is done yet; this section tracks the phase list in [TODO.md](TODO.md) and is cut into
release notes when it ships.

### Added

- Board renderer: boxed 4×3 cells, five derived skins, three size tiers.
- Engine support: any UCI engine, resolved from `--engine` → `$TOKENMATE_ENGINE` → `PATH`, 20-level Elo ladder,
  `tokenmate doctor`.
- Game core: full rules via chess.js, undo/redo, takeback, resign, PGN and FEN, resumable games, `--seed`.
- TUI: three layouts, eval bar, move list, captured pieces, clocks, keyboard and mouse, `?` help.
- Optional model opponent: models.dev catalogue, Ollama and LM Studio discovery, grounded move selection, coach mode.
- Import from chess.com and Lichess, replayed through the same renderer.

[Unreleased]: https://github.com/AmariahAK/tokenmate/commits/main
[0.1.0]: https://github.com/AmariahAK/tokenmate/releases/tag/v0.1.0

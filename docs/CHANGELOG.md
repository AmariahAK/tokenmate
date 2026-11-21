# Changelog

All notable changes to this project are documented here. The format is [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- A pty that reports `columns: 0` collapsed the entire screen to a one-column "terminal too small" message: the fallback
  used `?? 80`, which only catches `undefined`, so a `0` went straight through. Found by running the app under a pty
  rather than by any unit test, which is why there is now one with `0` in it.
- En passant was reported as a **quiet move**: chess.js 1.4.0 returns `false` from `isCapture()` for it while still
  reporting the taken pawn, so the legal-move list a model reads had the capture flag wrong. Caught by a test that
  asserted the flag, not by review.
- The footer notice was clipped at the window width, and a model-fallback notice was ~105 cells in a 96-cell window —
  so the part that got cut was the outcome ("the engine moved instead"). Notices now lead with the outcome and the
  reason goes to the Thoughts panel, which has room for it.
- `?` did not open help on terminals that report it as `/` plus shift rather than a bare `?`. Both shapes now normalise
  to the same key.
- The licence gate could not see **LGPL**: the pattern only matched `GPL`/`AGPL`, so `LGPL-2.1-or-later` inside a
  compound `MIT AND LGPL-2.1-or-later` string passed silently. It now matches `GPL`, `AGPL` and `LGPL`, and
  `--strict` ignores the allowlist so the difference between "no copyleft" and "one examined exception" is visible.
- The model's ASCII board used one glyph for both colours, so `♞` could not say *whose* knight sat on c4 — which is the
  entire point of grounding. It now uses upper case for white and lower case for black, the convention every model has
  already seen.

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
- Optional model layer: `src/models/catalog.ts` reads models.dev with an `If-None-Match` recheck (an hourly recheck
  usually costs one 304), `src/models/local.ts` discovers Ollama and LM Studio at runtime because models.dev carries
  neither, and `src/models/brain.ts` grounds the model on a FEN + ASCII board + the exact legal-move list. A reply
  counts only if it names a move **we** offered, so a hallucinated knight cannot reach the board; one retry, then the
  engine plays instead. Keys come from the provider's env var or a `0600` config file, and are never printed whole.
- Import: chess.com public archives (no auth, keeps the `accuracies` already computed) and lichess multi-game PGN with
  the descriptive `User-Agent` it requires — without one it answers 404. Parsing only, so it works with no engine.
- Screen composer `src/ui/screens.ts` + `src/ui/ansi.ts`: game/help/setup frames, eval bar, move list, captured, clocks,
  truecolor / 256-colour / no-colour output, and every frame asserts its own borders before it is shown.
- Engine layer, engine-agnostic by construction: `src/engine/resolve.ts` (`--engine` → `$TOKENMATE_ENGINE` → `PATH`,
  command strings with arguments, OS-specific install hint), `uci.ts` (handshake, `MultiPV`, capability probe, teardown
  with no orphaned child), `any-uci.ts` (adapts to whatever the engine advertises), `ladder.ts`, `analysis.ts`.
  Driven in tests by a fake UCI engine over a real pipe, so the process boundary is exercised without shipping one.
- Game core `src/game/session.ts`: chess.js as the only legality gate, undo/redo, takeback, resign and draw offers,
  PGN import/export, FEN load, clocks, `--seed` determinism, and `resume.ts` for an in-progress game.
- The app itself: `src/terminal.ts` (raw mode, key normalisation, resize, colour-mode negotiation) and `src/cli/play.ts`
  (cursor selection, hjkl and arrow aliases, hint, undo, resign, skin cycling, `?` help, engine seat, model seat with
  engine fallback). `src/cli.ts` is the `bunx tokenmate` entry: `play`, `doctor`, `import`, `replay`, `resume`, `help`.
- `tokenmate doctor` reports Bun, the engine and where it came from, its `UCI_Elo` range, whether the build can actually
  reach the top levels, the catalogue age, which local models are running, cache warmth and the saved game.
- `src/models/chat.ts` — OpenAI-compatible transport with a token cap and a per-turn timeout, local providers needing no
  key, and an explicit refusal (by name) for providers whose API is not OpenAI-shaped.

## [0.1.0] — unreleased

First release. Nothing here is done yet; this section tracks the phase list in [TODO.md](TODO.md) and is cut into
release notes when it ships.

### Added

- Board renderer: boxed 4×3 cells, five derived skins, three size tiers.
- Engine support: any UCI engine, resolved from `--engine` → `$TOKENMATE_ENGINE` → `PATH`, 20-level Elo ladder,
  `tokenmate doctor`.
- Game core: full rules via chess.js, undo/redo, takeback, resign, PGN and FEN, resumable games, `--seed`.
- TUI: three layouts, eval bar, move list, captured pieces, clocks, keyboard with hjkl aliases, `?` help. Mouse
  click-to-move is not in this release.
- Optional model opponent: models.dev catalogue, Ollama and LM Studio discovery, grounded move selection, coach mode.
- Import from chess.com and Lichess, replayed through the same renderer.

[Unreleased]: https://github.com/AmariahAK/tokenmate/commits/main
[0.1.0]: https://github.com/AmariahAK/tokenmate/releases/tag/v0.1.0

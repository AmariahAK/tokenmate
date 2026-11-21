# Changelog

All notable changes to this project are documented here. The format is [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **A built-in chess engine**, so tokenmate plays with nothing installed. Stockfish and any other UCI engine become an
  optional upgrade rather than a prerequisite. `src/builtin/`: 0x88 board, alpha-beta search with quiescence, material
  and piece-square evaluation, iterative deepening, loss-weighted multi-candidate output for the weak levels.
- The built-in's move generation is verified against the six standard perft positions — startpos to depth 4 (197,281)
  and Kiwipete to depth 3 (97,862) among them. Proved the suite can fail: dropping castling generation breaks 2 tests,
  removing checkmate detection breaks 1, both green again on restore.
- Built-in strength is reported as an **estimate** (depth 6 ≈ 1550 Elo), and a level that asks for more than the
  built-in can play says so and names the fix instead of printing an Elo it cannot reach.
- **A setup menu**, so a first run does not require reading `--help`: bare `tokenmate` opens Play / Level / Colour /
  Theme / Quit, and the Level list is the real 20-level ladder with the Elo each one plays and how it gets there
  (`sampled`, `native`, `full`). The list follows the selection, because 20 levels never fit a 24-row terminal and a
  truncating window would hide level 20 exactly when someone scrolls towards it.
- `tokenmate play --level N` still starts straight into the board with no screen, so scripts and the tests keep working.
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

### Changed

- `startEngine` falls back to the built-in when nothing is on `PATH`, but a **named** engine (`--engine`, or
  `$TOKENMATE_ENGINE`) that fails to start is still an error — no silent substitution.
- `tokenmate doctor` leads with the built-in as always available and reports Stockfish as optional. The old
  "missing — no UCI engine found" wording is gone, along with the test that asserted it.
- `tokenmate play` with no options opens the menu too; any option skips it. The help text said "skip the menu" for a
  bare `play`, which was not what the code did.
- Measured search cost, which sets the cap: depth 6 in 0.9–1.9 s middlegame, depth 7 needs 6–8 s.

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

- The engine's reply was never painted: the loop redrew *before* searching, so after the opponent moved the board and
  the status line stayed one move behind until an unrelated keypress. Found by reading a frame out of a real pty, and
  now asserted by a test that presses nothing after the reply lands.
- The hint key could not be reached. `h` is vim-left in the movement aliases, and the movement branch returns first, so
  `h` always moved the cursor and the hint code was dead. The hint is now `H`, and a shifted letter is never swallowed
  as a cursor move.
- The help overlay promised `t`, `c`, `tab`, `m`, `d`, `p` and `ctrl+r`, none of which `handle` implements. It now lists
  only the keys that exist; the missing ones are tracked in [TODO.md](TODO.md) instead of advertised in-app.
- One copyleft dependency is examined and allowed: `@opentui/core-*` statically links a decode-only FFmpeg 9.0.2 built
  with GPL and non-free parts disabled. It is installed from npm rather than redistributed, and the dylib is never
  baked into our build output. Reasoning in
  [ARCHITECTURE.md](ARCHITECTURE.md#5-licence--scriptscheck-licencests).

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

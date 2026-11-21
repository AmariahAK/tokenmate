# tokenmate — todo

The live checklist. **Unchecked means not done** — not "mostly done", not "done except a detail". If something is
ambiguous while building it, it becomes a linked TODO here rather than a silent assumption.

Mirrors the phases in [PLAN.md](PLAN.md). Every behaviour change also gets a [CHANGELOG.md](CHANGELOG.md) entry —
see [CONTRIBUTING.md](../CONTRIBUTING.md#the-one-rule).

## Phase 0 — Repo prep

- [x] `README.md` — what it is, install per OS, engine install step, bring-your-own-model, MIT badge
- [x] board image in the README (`<!-- BOARD:README -->` → `docs/board.svg`)
- [x] repo description + topics
- [x] `LICENSE` (MIT), `.gitignore`, `.editorconfig`
- [x] `package.json` — `bin`, `engines` (bun >= 1.4), scripts
- [x] `tsconfig.json` — strict, `noUncheckedIndexedAccess`

## Phase 1 — `docs/`

- [x] `docs/PLAN.md`
- [x] `docs/TODO.md`
- [x] `docs/CHANGELOG.md`
- [x] `docs/ARCHITECTURE.md`
- [x] `CONTRIBUTING.md` with the sync rule

## Phase 2 — Board renderer

Port the design that was already verified in the browser relic. Port, do not rewrite: the geometry maths, palette
derivation and centring proof all passed their gates in the prototype, and re-deriving them by hand is how they break.

- [x] `src/ui/palette.ts` + `src/ui/contrast.ts` — hex mixing, luminance targeting, WCAG ratio
- [x] `src/ui/theme.ts` — five skins as data, palette derived, highlights hue-shifted at constant luminance
- [x] `src/ui/grid.ts` — cell framebuffer, border drawing with clipping, `assertBorders`
- [x] `src/ui/board.ts` — boxed 4×3 (32×24, shipping), wide 6×3 (48×24), compact 2×1 (16×8, ASCII letters)
- [x] `src/ui/layout.ts` — tier selection from terminal size, panels only when they fit
- [x] `test/contrast.test.ts` — every square state ≥ 3:1 against both piece fills, plus a mutation theme that fails
- [x] `test/layout.test.ts` — centring (38,345 audit + 4 padding = the 38,349 baseline, 0 failures), two mutation
      gates (board one cell out → 224 failures; one glyph nudged → exactly 1), tier selection
- [x] board image `docs/board.svg` from the real renderer, referenced at `<!-- BOARD:README -->`

## Phase 3 — Engine + ladder

- [x] `src/engine/resolve.ts` — resolution order, commands with args, friendly OS-specific failure
- [x] `tokenmate doctor` — Bun, engine found + version, `UCI_Elo` range, cache warmth
- [x] `src/engine/uci.ts` — spawn, handshake, `MultiPV`, teardown with no orphan processes, capability probe
- [x] `src/engine/any-uci.ts` — adapt to whatever engine is present; depth/time handicap when `UCI_Elo` is absent
- [x] `src/engine/ladder.ts` — MultiPV sampling for 1–7, native `UCI_Elo` for 8–19, full for 20; levels 1–20 only,
      no named presets
- [x] `src/engine/analysis.ts` — eval, best line, blunder detection from the same search
- [x] warm-up + `isready`; `--depth` override

## Phase 4 — Game core

- [x] `src/game/session.ts` — state machine, chess.js as the only legality gate
- [x] undo/redo, takeback, resign, draw offers
- [x] PGN import/export, FEN load/copy
- [x] `src/game/resume.ts` — save and restore an in-progress game
- [x] deterministic `--seed`

## Phase 5 — TUI

- [x] layouts: big (96×37) / medium (88) / compact, chosen from the terminal size (`src/ui/layout.ts` +
      `src/ui/screens.ts`; there is no separate `app.ts` — the composer and the loop in `src/cli/play.ts` cover it)
- [x] panels: eval bar, move list, analysis/thoughts, captured, clocks
- [x] keyboard + hjkl aliases, `?` help overlay
- [ ] mouse click-to-move
- [ ] setup screen wired into `play` (the frame exists in `screens.ts`; `--color`/`--level`/`--clock`/`--opponent`
      are flags today, not a first-run screen)
- [x] spectate two AIs locally (`--spectate`, `--model a/b,c/d`); replay an imported game
- [ ] spectate over SSH (OpenTUI's SSH binding) — deferred with the OpenTUI integration below
- [x] graceful resize; truecolor + 256 + no-colour fallbacks

## Phase 5b — Terminal backend

- [x] `src/terminal.ts` — raw mode, key normalisation, resize, colour negotiation, interface so the loop is testable
- [ ] drive the frames through `@opentui/core` instead of writing ANSI directly. OpenTUI 0.9.7's renderer is a native
      scene graph: hosting our finished frames means re-expressing the screens as renderables (or a custom Renderable
      that blits styled cells), which is a bigger change than it looks and would replace the composer that has the
      border and contrast gates. It is installed and in the dependency tree; the seam is `Terminal`.


## Phase 6 — Models

- [x] `src/models/catalog.ts` — models.dev, ETag conditional GET, hourly refresh, disk cache
- [x] `src/models/local.ts` — Ollama and LM Studio discovery (`/api/tags`, `/v1/models`; neither is in models.dev)
- [x] `src/models/brain.ts` — grounding, zod-validated `{move}`, retry once then engine fallback, opponent/coach modes
- [x] token budget, per-turn timeout, keys never logged (`src/models/config.ts`, 0600 enforced, `redact`)

## Phase 7 — Import

- [x] `src/import/games.ts` — chess.com public archives, no auth, keeps the `accuracies` it already computes
- [x] lichess with a descriptive `User-Agent` — without one the endpoint answers 404 (verified; there is a test)
- [x] multi-game PGN split, local PGN fallback; parsing only, so it needs no engine

## Phase 8 — Release v0.1.0

- [x] board image in the docs, generated by the renderer itself (`bun run board`)
- [ ] screenshots of the real app in the README
- [ ] `bunx tokenmate` smoke test on macOS + Linux; Windows/WSL documented honestly (only `bun run src/cli.ts` has been
      run so far — `bunx` needs the package published first)
- [ ] tag `v0.1.0`

## Open questions

- **OpenTUI as the driver.** The owner chose OpenTUI; the app currently writes frames straight to the terminal because
  the composer already produces a finished frame and OpenTUI's renderer is a scene graph. Options: (a) keep the plain
  backend and use OpenTUI only for its SSH spectating binding later, (b) write a custom `Renderable` that blits our grid
  into OpenTUI's buffer, (c) re-express every screen as OpenTUI renderables and delete the composer. Nothing is decided.

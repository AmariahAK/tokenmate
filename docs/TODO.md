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

- [ ] `src/engine/resolve.ts` — resolution order, commands with args, friendly OS-specific failure
- [ ] `tokenmate doctor` — Bun, engine found + version, `UCI_Elo` range, cache warmth
- [ ] `src/engine/uci.ts` — spawn, handshake, `MultiPV`, teardown with no orphan processes, capability probe
- [ ] `src/engine/any-uci.ts` — adapt to whatever engine is present; depth/time handicap when `UCI_Elo` is absent
- [ ] `src/engine/ladder.ts` — MultiPV sampling for 1–7, native `UCI_Elo` for 8–19, full for 20; levels 1–20 only,
      no named presets
- [ ] `src/engine/analysis.ts` — eval, best line, blunder detection from the same search
- [ ] warm-up + `isready`; `--depth` override

## Phase 4 — Game core

- [ ] `src/game/session.ts` — state machine, chess.js as the only legality gate
- [ ] undo/redo, takeback, resign, draw offers
- [ ] PGN import/export, FEN load/copy
- [ ] `src/game/resume.ts` — save and restore an in-progress game
- [ ] deterministic `--seed`

## Phase 5 — TUI

- [ ] `src/app.ts` — big (96×37), medium (88), compact layouts
- [ ] panels: eval bar, move list, analysis/thoughts, captured, clocks
- [ ] keyboard + hjkl aliases, mouse click-to-move, `?` help overlay
- [ ] setup screen: colour, level 1–20, clock, opponent
- [ ] spectate two AIs; replay an imported game
- [ ] graceful resize; truecolor + 256 + no-colour fallbacks

## Phase 6 — Models

- [ ] `src/models/catalog.ts` — models.dev, ETag conditional GET, hourly refresh, disk cache
- [ ] `src/models/local.ts` — Ollama and LM Studio discovery
- [ ] `src/models/brain.ts` — grounding, zod-validated `{move}`, retry once then engine fallback, opponent/coach modes
- [ ] token budget, per-turn timeout, keys never logged

## Phase 7 — Import

- [ ] `src/import/chesscom.ts` — public archives, no auth
- [ ] `src/import/lichess.ts` — with a descriptive User-Agent (required, see PLAN.md)
- [ ] replay through the same renderer; PGN fallback; works with no engine

## Phase 8 — Release v0.1.0

- [ ] README screenshots from the real app
- [ ] `bunx tokenmate` smoke test on macOS + Linux; Windows/WSL documented honestly
- [ ] tag `v0.1.0`

## Open questions

None yet. Anything that cannot be decided while building goes here as a TODO with the options spelled out.

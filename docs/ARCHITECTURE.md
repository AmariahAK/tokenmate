# tokenmate — architecture

Module map, the direction dependencies are allowed to point, and the invariants that make certain classes of bug
impossible instead of unlikely.

## Shape

```
cli.ts                 argv → mode, everything else is a library call
  │
  ├─ app.tsx           OpenTUI: layout, focus, keyboard and mouse
  │    ├─ ui/          pure rendering, no I/O, no chess knowledge beyond FEN
  │    └─ game/        pure state, no rendering
  │
  ├─ builtin/          the engine we ship: board, movegen, eval, search
  ├─ engine/           subprocess boundary: one UCI engine, one ladder
  ├─ models/           HTTP boundary: catalogue, discovery, grounded move choice
  └─ import/           HTTP boundary: chess.com, Lichess
```

Dependencies point **inwards**: `cli` knows about everything, `ui` and `game` know about nothing above them, and
`ui` never imports `engine`, `models` or `import`. The renderer takes a FEN string and a set of marks; that is the
entire contract. This is what makes replay, review and spectate the same code path as playing.

`ui` and `game` are both pure — given the same input they produce the same output, with no clock, no network, no
randomness. That is what makes the Phase 2 gates meaningful: they can assert against exact bytes.

## Modules

### `src/builtin/`

| module | owns |
| --- | --- |
| `position.ts` | the 0x88 board, legal move generation, make/unmake, perft |
| `eval.ts` | material and piece-square evaluation, in centipawns |
| `search.ts` | negamax with alpha-beta, quiescence, iterative deepening |
| `index.ts` | the seat the game loop drives, and level-to-depth mapping |

This is the engine that makes the app playable with nothing installed; `engine/` is the *optional* UCI upgrade. The
split matters: `builtin/` has no subprocess, no timeout and no stdout, so it is testable as plain functions.

Correctness is defined by **perft** — the legal-move-sequence count from a position, checked against the six standard
positions. A movegen bug changes a count, so the suite is the difference between "it plays chess" and "it looks like
it plays chess". The search is deliberately plain: no transposition table and no null-move pruning, because strength is
bounded by the per-move time budget anyway, and every feature added there is one more thing between a bug and the board.

Strength claims carry a **ceiling**: the built-in tops out near 1550 Elo at depth 6, so a level asking for more says so
and names the fix. Estimates are labelled `estimate` everywhere they appear, because there is no rated opponent to
measure against.

### `src/ui/`

| module | owns |
| --- | --- |
| `grid.ts` | a cell framebuffer — the same model OpenTUI uses, so a frame can be handed over cell by cell. Style per cell, wide glyphs as two cells with a continuation marker, a border registry with clipping (`limit`, `text`) and `assertBorders`. Border drawing lives here because it needs the cell rows; a separate `boxes.ts` would only have needed an accessor API for nothing. |
| `board.ts` | FEN parsing to a piece matrix, glyphs, square names, the square-state `Marks` type (cursor, selected, last move, check, hint), the 4×3 / 6×3 / 2×1 tiers, the `padding` maths and the two board renderers. |
| `theme.ts` | five skins as data; every colour in a skin is *derived* from a base hue, never hand-picked. |
| `palette.ts` | hex ↔ channel mixing, luminance, and `atLum` (scale channels until a target luminance, preserving hue). |
| `contrast.ts` | WCAG relative luminance ratio — the maths the theme gate asserts with, built on `palette.ts` so there is one luminance implementation. |
| `layout.ts` | tier selection from terminal size, and whether the side panels fit. |
| `screens.ts` | whole-frame composition for each screen (game, setup, review, help). Phase 5, not yet written. |

`@opentui/core` 0.9.7 has **no JSX runtime** — JSX lives in the separate `@opentui/react` and `@opentui/solid` packages.
tokenmate does not take either dependency: the app is imperative renderables, and a composed `Grid` is handed to the
terminal as one ANSI span. That keeps the board a framebuffer we control (and can assert on) instead of a tree of nested
boxes whose geometry we would have to re-derive.

### `src/engine/`

Split so that the parts that are hard to test are small:

| module | owns |
| --- | --- |
| `resolve.ts` | turning `--engine` / `$TOKENMATE_ENGINE` / `PATH` into a spawnable command, plus the OS-specific failure message. |
| `uci.ts` | the process: spawn, `uci`/`isready` handshake, `position`/`go`, `MultiPV`, `stop`, teardown that leaves no orphans. |
| `any-uci.ts` | capability probe — does this engine have `UCI_Elo`? `Skill Level`? Neither? — and the handicap strategy when it has neither. |
| `ladder.ts` | level 1–20 → engine settings. The table exists **only** here. |
| `analysis.ts` | eval, best line and blunder detection, taken from the search that produced the move rather than a second search. |

### `src/game/`

`session.ts` is a state machine over chess.js: it holds the position, the move history, clocks and result, and it
accepts a move **only** if chess.js validates it. `resume.ts` serialises a session to disk so an interrupted game
survives.

### `src/models/`

`catalog.ts` (models.dev with a conditional GET — an unchanged catalogue returns 304 and costs nothing), `local.ts`
(Ollama and LM Studio discovery, because models.dev does not carry them), `brain.ts` (builds the grounded prompt,
parses `{move}`, validates it, retries once, falls back to the engine).

## Invariants

Each one lives at a module boundary, and the check runs in `bun run check`. They are here rather than in a code review
checklist because all five have the same failure mode: a plausible-looking build that is quietly wrong.

### 1. Contrast — `ui/theme.ts`, asserted by `test/contrast.test.ts`

Every square state (light, dark, cursor, selected, last move, check, legal-move dot, hint) must reach **≥ 3:1** against
both piece fills, per WCAG 1.4.11 for non-text contrast. Worst measured in the design: 3.10 (neon, the hardest skin)
and 4.03 (slate).

*Why module-level:* highlights are hue shifts at constant luminance, so adding a skin can silently produce a state that
is invisible rather than wrong-looking. The check has to cover the generated combinations, not the five that were
looked at by eye.

### 2. Centring — `ui/board.ts`, asserted by `test/layout.test.ts`

Every glyph must sit exactly centred in its square. The audit makes 38,345 assertions across 5 skins × 5 geometries
(each cell's background, a check per empty square, five per piece, both label rows) — 38,349 with the four `padding`
refusals — and 0 failures.

Two **mutation gates** prove it can fail: a board drawn one cell out produces exactly 224 failures (192 cells landing on
the neighbouring square, 32 pieces off centre), and nudging a single glyph one cell produces exactly one failure, on the
right square, for the right reason.

*Why module-level:* a terminal cannot scale a glyph, so the board's size lives in the square. That means padding maths,
and padding maths is the kind of code that looks right at 4×3 and breaks at 6×3.

### 3. Rules — `game/session.ts`

No move reaches the board, the PGN or the engine unless chess.js validated it. The renderer draws a FEN; it does not
know what a legal move is. The model proposes a move; it does not get to apply one.

*Why module-level:* there is exactly one place that can accept a move, so there is exactly one place to audit.

### 4. Grounding — `models/brain.ts`

A model may only pick from a legal-move list **we** generated, sent as JSON next to the FEN, the ASCII board and the
last three plies. Its answer is parsed as `{move}` and checked against that list. Illegal or unparseable → retry once →
engine move.

*Why module-level:* the alternative — trusting a model to produce a legal SAN string — fails intermittently and in ways
that look like a rendering bug. The list makes an illegal move unrepresentable.

### 5. Licence — `scripts/check-licences.ts`

The build fails if a GPL/AGPL dependency enters the tree. No engine binary is committed or bundled; `.gitignore` keeps
engine binaries and `*.wasm` out.

*Why module-level:* one `bun add` is all it takes to make an MIT project undistributable, and it happens in a commit
that looks like it is only about a feature.

There is exactly **one** examined exception, and the gate prints it on every run rather than hiding it:

> `@opentui/core-*` (the prebuilt native library) declares `MIT AND LGPL-2.1-or-later`. The LGPL part is a
> **decode-only FFmpeg 9.0.2** compiled into `libopentui` with `--disable-gpl --disable-nonfree`, for OpenTUI's video
> support — which tokenmate never calls. Upstream ships the exact FFmpeg source hash, its build script and relink
> instructions, we install the package from npm rather than redistributing it, and `bun build --target bun` never bakes
> the dylib into our tarball. So no LGPL object ships **inside** tokenmate.

`bun run check:licences:strict` ignores the allowlist and asserts there is **zero** copyleft in the tree. It fails today
on that one package, and that is the point: run it before any single-file release. If delivery ever moves to a
`bun build --compile` binary — which *would* bake the dylib in — the answer has to change before the release does.

## Geometry, and why the board is 4×3

A cell is roughly 2.2× taller than it is wide at the shipped font metrics (0.6 em advance, 1.32 line height), so the
number of cells per square sets both the piece size and how square the board looks:

| tier | cells per square | board | aspect | piece |
| --- | --- | --- | --- | --- |
| wide | 6×3 | 48×24 | ~1:1.10 | 8.3% of a square |
| boxed | 4×3 | 32×24 | ~1:1.65 | 8.3% of a square |
| compact | 2×1 | 16×8 | ~1:1.10 | ASCII letters, no box |

4×3 is **not** the most square option — 6×3 and 2×1 both come closer to 1:1. It was chosen with those numbers in front,
because it is the largest square that still fits an 80-column terminal with side panels. The trade is deliberate and is
not to be "fixed" by someone who measures the aspect ratio later.

Two constraints fall out of the centring maths and are enforced in code, not in a comment:

- `cw` must be **even** — a chess glyph is East-Asian-ambiguous and occupies two cells, so the leftover columns have to
  split evenly;
- `ch` must be **odd** — the leftover rows have to split around a single centre row.

`padding()` throws on anything else rather than producing a board that is off by one cell on one axis.

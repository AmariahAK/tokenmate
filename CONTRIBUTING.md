# Contributing to tokenmate

Thanks for wanting to help. Most of this is normal open-source etiquette; one rule is enforced.

## The one rule

**A behaviour change updates [docs/TODO.md](docs/TODO.md) and [docs/CHANGELOG.md](docs/CHANGELOG.md) in the same PR.**

- Behaviour PRs: tick or add the TODO item, and add the CHANGELOG line under `## [Unreleased]`.
- Scope changes: update [docs/PLAN.md](docs/PLAN.md) **first**, in its own commit, so the discussion is about the plan
  and not about a diff nobody expected.
- A docs-only fix needs no CHANGELOG entry.

`docs/TODO.md` is a promise: an unchecked box means the thing is not done. Do not tick a box because the code is
"basically there" — tick it when it works and has a test that can fail.

## Before you open a PR

```bash
bun run check        # tsc --noEmit, then the test suite, then the licence gate
```

All three must be green. `bun run check` is what CI runs; there is no separate hidden gate.

Do not open a PR that leaves a failing check with a comment saying it is fine.

## Tests

- A test only counts if it **can** fail. Prove it: break a copy of the code in a scratch directory, watch the test go
  red for the right reason, then restore. The two Phase 2 gates were built this way — the centring test fails exactly
  800 times when one axis is offset by one cell.
- Non-trivial logic needs a test. Rendering maths, the ladder table, move validation and prompt grounding all need one.
- Never commit a test that asserts on a stub you also wrote in the same PR and that would pass whatever the
  implementation did.

## Licence

tokenmate is **MIT**. Contributions are accepted under the same licence.

**No copyleft code may enter this repository or the published package.** That includes:

- GPL, AGPL, LGPL, SSPL, OSL, EUPL, CPAL and CC-BY-SA dependencies;
- **copied or adapted source from a GPL project.** [chess-tui](https://github.com/thomas-mauran/chess-tui) is GPL-3.0,
  so its code, art and data files cannot be pasted in, even translated or "just the interesting bits". Ideas are fine
  and are credited in [docs/PLAN.md](docs/PLAN.md); code is not.
- a chess engine binary, `*.wasm` build of one, or a release artefact containing one. The engine is a runtime
  dependency the user installs — see the README.

`bun run check:licences` fails the build if a copyleft package appears in the dependency tree. It only sees the tree,
so it cannot catch copied code: that part is on the reviewer.

One dependency is examined and allowed — `@opentui/core-*`, whose native library statically links a decode-only
**LGPL-2.1** FFmpeg built with GPL and non-free parts disabled. The reasoning, and why it puts no LGPL code inside our
artefact, is in [ARCHITECTURE.md](docs/ARCHITECTURE.md#5-licence--scriptscheck-licencests). Adding a second exception
means editing the allowlist in `scripts/check-licences.ts` with the same level of justification, in the PR that needs it.

`bun run check:licences:strict` ignores the allowlist and must be run before any single-file release.

## Code

- TypeScript, strict mode, `noUncheckedIndexedAccess`. No `any` where a real type fits.
- `src/ui` and `src/game` stay **pure** — no network, no clock, no subprocess, no filesystem. That is what makes the
  renderer's gates assertable byte for byte, and it is worth protecting.
- Comments explain **why**, not what. If a line needs a comment to say what it does, rename something instead.
- Reuse what is already there: a colour, a constant, a helper. Duplicating the ladder table or the theme derivation is
  how the two copies drift apart.

## Reporting bugs

Include the output of:

```bash
tokenmate doctor
```

It reports the Bun version, whether an engine was found and which, and the `UCI_Elo` range that engine accepts. Most
"the AI plays badly" and "level 20 is too easy" reports are a distro engine from years ago, and `doctor` shows that in
one screen.

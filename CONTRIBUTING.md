# Contributing to tokenmate

Thanks for helping build tokenmate. This guide covers how to set up, what we expect in a pull request, and the rules every change has to follow.

tokenmate is maintained by the [Atlarix team](https://atlarix.dev). By taking part you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Report a bug**: open an issue with the bug report template.
- **Suggest a feature**: open an issue with the feature request template. For anything large, please wait for a maintainer to agree on the approach before writing code.
- **Fix something**: issues labelled `good first issue` or `help wanted` are a good place to start. Comment on the issue so others know you're working on it.

## Setup

You need [Bun](https://bun.sh) 1.4 or newer.

```sh
git clone https://github.com/<your-username>/tokenmate.git
cd tokenmate
bun install
bun run dev
```

`bun run dev` restarts the app when files change. `bun start` runs it once.

## Workflow

1. Fork the repo and create a branch from `main`, named for the change: `feat/pvai-mode`, `fix/promotion-cancel`, `docs/controls`.
2. Keep each PR to one focused change. Split unrelated work into separate PRs.
3. Run all checks locally before pushing (below).
4. Open a PR against `main` and fill in the PR template completely.
5. A maintainer reviews it. Please respond to feedback by pushing new commits rather than force-pushing, so the review history stays readable.

## Checks

Every PR must pass all of these. CI runs the same commands.

```sh
bun run typecheck
bun run lint
bun test
```

`bun run format` fixes formatting and import order automatically.

## Code guidelines

- **Use the existing structure.** Chess rules live in `src/game/`, the built-in bot in `src/engine/`, UI in `src/ui/`. New kinds of players (LLM, Stockfish) implement the `Player` interface in `src/game/player.ts`, the same way `HumanPlayer` and `BotPlayer` do, instead of adding special cases to the game or UI.
- **Reuse before you add.** Prefer what the codebase, chess.js, OpenTUI or Bun already provide over new code or new dependencies. Explain any new dependency in the PR.
- **TypeScript strict mode.** No `any` unless there's a clear reason.
- **Keep changes small and in the style of the surrounding code.**
- **No comment noise.** Don't add comments that restate the code. Only comment the non-obvious _why_. Remove debug logging and commented-out code before opening a PR.
- **Write tests** for new logic and bug fixes. A bug fix should include a test that fails without the fix.

## Never commit

- **Stockfish binaries, source or NNUE network files.** Stockfish is GPL-3.0 and tokenmate is MIT, so it is always downloaded at runtime or provided by the user, never included in the repo or releases.
- **API keys, tokens or `.env` files.** Use environment variables or the local config. If you commit a key by accident, revoke it straight away. Removing it from git history isn't enough.
- **Personal game data** (exported PGNs from your Lichess or Chess.com account, etc.).

## Pull request description

Every PR description must answer these five questions. The PR template has them as headings:

1. **What was the issue?** The bug, missing feature or problem, in plain words.
2. **Where was the issue?** The files, modules or screens involved.
3. **How did you fix it?** What you changed.
4. **Why did you choose this method over others?** The alternatives you considered and why this one is better.
5. **How to test it locally?** Exact steps a reviewer can follow to see it working.

Link the related issue with `Closes #123` when there is one.

## Commit messages

Use short, imperative messages, optionally with a [Conventional Commits](https://www.conventionalcommits.org) prefix:

```
feat: add promotion picker
fix: keep cursor on board after flip
docs: document controls
```

## Questions

Open an [issue](https://github.com/AmariahAK/tokenmate/issues) if anything here is unclear, or email [support@atlarix.dev](mailto:support@atlarix.dev).

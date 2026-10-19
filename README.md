# tokenmate

**Terminal chess where you bring your own AI.**

Play any LLM from your terminal, watch two models battle and banter, and get coached using Stockfish and your own Lichess / Chess.com games. Free, open source, bring your own keys.

[![CI](https://github.com/AmariahAK/tokenmate/actions/workflows/ci.yml/badge.svg)](https://github.com/AmariahAK/tokenmate/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **Status:** early development. Today you can play the built-in bot or a friend on the same terminal. The LLM features below are on the roadmap and contributions are welcome.

## Features

Available now:

- Home screen to pick a game: play the built-in bot (easy, medium or hard, as white, black or random) or a friend on the same terminal
- Built-in bot that works offline with no API key: a small alpha-beta search that runs in a background worker, so the board stays responsive
- Full chess rules (castling, en passant, promotion, check, checkmate, stalemate, threefold repetition, fifty-move rule, insufficient material)
- Keyboard-driven board with legal-move hints, last-move highlight and board flip
- The board grows with your terminal window; large squares draw multi-line pieces, with Unicode glyphs one key away
- Scrollable move list in standard algebraic notation, undo and new game

## Roadmap

- **Player vs AI**: pick any model and play it on the board.
- **AI vs AI**: pit two models against each other. Each model's _thinking_ is shown to you but kept private from its opponent, while the _words_ they say are shared as a live chat between them.
- **Bring your own model**: the model list comes from [models.dev](https://models.dev), cached locally and refreshed every hour. Add your API key for any listed provider.
- **Custom providers**: add your own OpenAI-compatible or Anthropic-compatible endpoint on top of the built-in list.
- **Evaluation**, from any of these sources:
  - Stockfish: point tokenmate at your own binary, or let a tokenmate command download it for you.
  - LLM self-review: games are saved so the models can review their own play.
  - A separate evaluator: another Stockfish or LLM of your choice reviews the game.
- **AI coach**: import your games from Lichess or Chess.com and get a free AI mentor that finds your recurring mistakes and helps you improve.
- **Game history**: finished games saved locally as PGN, with a list on the home screen to replay or review them.
- **Play people online**: sign in with Lichess and get paired with real opponents through the official Lichess Board API, played on the tokenmate board.

## Requirements

- [Bun](https://bun.sh) 1.4 or newer
- A terminal with Unicode and true-color support (most modern terminals). The board scales to the window: multi-line pieces need at least 92x28 cells, and a taller window gives bigger squares.

## Getting started

```sh
git clone https://github.com/AmariahAK/tokenmate.git
cd tokenmate
bun install
bun start
```

The home screen opens first. Use up/down to pick a setting, left/right to change it and `Enter` to start.

## Controls

| Key | Action |
| --- | --- |
| Arrows / `h` `j` `k` `l` | Move the cursor |
| `Enter` / `Space` | Select a piece, then move it |
| `Esc` | Cancel selection |
| `u` | Undo (against the bot, takes back your move and its reply) |
| `f` | Flip the board |
| `p` | Switch between multi-line pieces and Unicode glyphs |
| `PgUp` / `PgDn` | Scroll the move list (the mouse wheel works too) |
| `n` | New game with the same settings |
| `m` | Back to the home screen |
| `q` / `Ctrl+C` | Quit |

When a pawn promotes, choose the piece with `q` (queen), `r` (rook), `b` (bishop) or `k` (knight).

## Tech stack

| Area | Choice |
| --- | --- |
| Runtime | [Bun](https://bun.sh) + TypeScript |
| Terminal UI | [OpenTUI](https://github.com/anomalyco/opentui) with [Solid](https://www.solidjs.com) |
| Chess rules | [chess.js](https://github.com/jhlywa/chess.js) |
| Lint / format | [Biome](https://biomejs.dev) |
| Tests | `bun test` |
| Planned | [Vercel AI SDK](https://ai-sdk.dev), [models.dev](https://models.dev), Stockfish (UCI), Lichess and Chess.com APIs |

## Project layout

```
bin/          CLI entry for the published package
src/
  index.tsx   renderer setup and shutdown
  app.tsx     switches between the home screen and a game
  game/       chess logic, game setup and the Player interface (human and bot now, LLMs later)
  engine/     built-in bot and the worker it runs in
  ui/         home screen, game screen, board, sidebar, promotion picker, key bindings, theme
test/         unit and render tests
```

## Stockfish and licensing

tokenmate is MIT licensed. [Stockfish](https://stockfishchess.org) is GPL-3.0, so tokenmate never includes Stockfish in this repository or in its releases. You either use a Stockfish binary you already have, or a tokenmate command downloads it onto your machine when you ask for it. Please don't open PRs that add Stockfish binaries or source.

## Maintainers

tokenmate is built and maintained by the [Atlarix team](https://atlarix.dev). Questions or concerns: [support@atlarix.dev](mailto:support@atlarix.dev).

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR, and follow our [Code of Conduct](CODE_OF_CONDUCT.md). To report a security problem, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Atlarix Team

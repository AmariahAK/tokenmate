# tokenmate

**Play, watch and analyse chess against any AI model — in your terminal.**

[![MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

`tokenmate` is a TUI chess game with two separate ideas about "AI" that most chess apps blur together:

- **The opponent is a chess engine.** 20 levels from 300 to 2800 Elo, all of it rule-based search and maths. No
  model, no API key, no network. A level is a level: no "easy", no "hard", no personality names to decode.
- **A model can take a seat — if you bring one.** Point tokenmate at any provider you have a key for, or at a local
  Ollama / LM Studio. The model *sees* the board, reasons about it in the open, and chooses its move from the legal
  moves the engine gives it. It cannot play an illegal move, because it never gets to invent one.

Then you can watch two models play each other, talk, and disagree — or have one explain your own mistakes.

<!-- BOARD:README -->
<img src="docs/board.svg" width="440" alt="tokenmate: the boxed 4×3 board in the slate skin, starting position">

<sub>The 4×3 board, slate skin, rendered by `bun run board` — the picture in this README comes from the same renderer the app draws with, at the same 32×24 cells.</sub>


## Install

```bash
bunx tokenmate
```

Requires [Bun](https://bun.sh) 1.4 or newer.

### The engine

tokenmate does **not** bundle a chess engine. Engines like Stockfish are GPL-3.0; tokenmate is MIT, and shipping one
inside the package would force the whole project to GPL. So you bring the engine and tokenmate drives it over UCI,
as a separate process.

```bash
# macOS
brew install stockfish

# Debian / Ubuntu
sudo apt install stockfish

# Windows (Chocolatey)
choco install stockfish
```

tokenmate finds it in this order:

1. `--engine <path or command>` — e.g. `--engine /opt/homebrew/bin/stockfish`
2. `$TOKENMATE_ENGINE`
3. `stockfish` on your `PATH`

Anything that speaks UCI works, not just Stockfish. Check what you have:

```bash
tokenmate doctor
```

**No engine? The app still runs.** Opening a game, replaying a PGN, importing from Lichess or chess.com and reviewing
positions all work without one. Only playing and live analysis need an engine.

## Play

```bash
tokenmate                                  # pick a level and play the engine
tokenmate --level 12                       # 1800 Elo
tokenmate --engine "gnuchess --uci"        # any UCI engine, with arguments
tokenmate --model anthropic/claude-haiku-5 # a model takes the seat
tokenmate --replay game.pgn                # watch a game back
```

Controls: arrows or `hjkl` to move, `space` to select and move, `esc` to cancel, `?` for help.

## Bring your own model

Cloud providers come from [models.dev](https://models.dev), re-checked hourly with a conditional request so an
unchanged catalogue costs nothing. Set the provider's usual environment variable — `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, whatever the provider documents — and pick a model.

Local models are discovered from the server you are running, because models.dev does not carry them:

| server | default endpoint |
| --- | --- |
| Ollama | `http://localhost:11434` |
| LM Studio | `http://localhost:1234` |

## Documentation

- [docs/PLAN.md](docs/PLAN.md) — the end goal, architecture and phases
- [docs/TODO.md](docs/TODO.md) — what is done and what is next
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — what shipped, per release
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules and invariants

## Contributing

Contributions and issues are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first — there is one rule about keeping
the docs in sync, and it is the only thing we are strict about.

## Licence

MIT. See [LICENSE](LICENSE).

tokenmate contains no GPL code. The chess engine is a runtime dependency you install yourself, and the build fails if a
copyleft package ever enters the dependency tree — `bun run check:licences`.

Design notes and rendered boards: [`relics/tokenmate-design/index.html`](relics/tokenmate-design/index.html).

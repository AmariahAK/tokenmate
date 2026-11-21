import { describe, expect, test } from "bun:test";
import { runGame, type EngineSeat, type Seat } from "../src/cli/play";
import { Session } from "../src/game/session";
import { themes } from "../src/ui/theme";
import { colorModeOf, normalizeKey, PlainTerminal, type Key, type Size, type Terminal } from "../src/terminal";
import { doctorReport, type DoctorFacts } from "../src/cli/doctor";
import type { ColorMode } from "../src/ui/ansi";
import type { Settings } from "../src/engine/any-uci";
import { makeChat, splitRef, ChatConfigError } from "../src/models/chat";
import { createBuiltin } from "../src/builtin/index";
import { Position, moveToUci } from "../src/builtin/position";
import { searchRoot } from "../src/builtin/search";
import { HELP, setupScreen } from "../src/ui/screens";
import { displayWidth } from "../src/ui/grid";
import { runSetup } from "../src/cli/setup";

/**
 * A terminal that records frames and lets the test press keys. This is the only
 * thing standing between the loop and a real TTY, which is exactly why the loop
 * takes a `Terminal` rather than reaching for `process.stdin`.
 */
class FakeTerminal implements Terminal {
  readonly colorMode: ColorMode = "none";
  frames: string[] = [];
  private keyFns: ((key: Key) => void)[] = [];
  private resizeFns: ((size: Size) => void)[] = [];
  started = false;

  size(): Size {
    return { cols: 96, rows: 37 };
  }
  draw(frame: string): void {
    this.frames.push(frame);
  }
  onKey(fn: (key: Key) => void): void {
    this.keyFns.push(fn);
  }
  onResize(fn: (size: Size) => void): void {
    this.resizeFns.push(fn);
  }
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.started = false;
  }
  get last(): string {
    return this.frames.at(-1) ?? "";
  }
  /** Keys are handled asynchronously, so a press has to yield before asserting. */
  async press(key: Key): Promise<void> {
    for (const fn of this.keyFns) fn(key);
    for (let i = 0; i < 4; i++) await Bun.sleep(0);
  }
}

const down: Key = { type: "special", name: "down", shift: false };
const up: Key = { type: "special", name: "up", shift: false };
const select: Key = { type: "special", name: "space", shift: false };
const char = (ch: string): Key => ({ type: "char", ch, ctrl: false, shift: false });

const settings = (note: string): Settings => ({
  level: 1,
  strategy: "sampling",
  elo: 300,
  options: {},
  go: { movetime: 50 },
  note,
});

const engineSeat = (move: string, note = "fake engine"): EngineSeat => ({
  settings: settings(note),
  search: async () => [{ move, score: { type: "cp", value: 20 } }],
});

const base = (over: Partial<Parameters<typeof runGame>[0]> = {}) => {
  const session = Session.newGame({ seed: 7 });
  const terminal = new FakeTerminal();
  return {
    session,
    terminal,
    opts: {
      session,
      terminal,
      theme: themes[0]!,
      seatOf: { white: { kind: "human" }, black: { kind: "human" } } as { white: Seat; black: Seat },
      labelOf: { white: "you", black: "you" },
      engine: null,
      level: 1,
      levelElo: 300,
      depth: null,
      ...over,
    } satisfies Parameters<typeof runGame>[0],
  };
};

const square = (name: string) => ({ file: "abcdefgh".indexOf(name[0]!), rank: Number(name[1]) - 1 });

/**
 * A player at the keyboard: arrows to a square, space to select. Used instead of
 * `session.move` wherever the test has to prove the input path, not the rules.
 */
class Player {
  private at = { file: 4, rank: 3 };

  constructor(private terminal: FakeTerminal) {}

  async move(uci: string): Promise<void> {
    await this.walk(square(uci.slice(0, 2)));
    await this.terminal.press(select);
    await this.walk(square(uci.slice(2, 4)));
    await this.terminal.press(select);
  }

  private async walk(to: { file: number; rank: number }): Promise<void> {
    const step = async (axis: "file" | "rank", to: number) => {
      while (this.at[axis] !== to) {
        const forward = this.at[axis] < to;
        const key: Key =
          axis === "file"
            ? { type: "special", name: forward ? "right" : "left", shift: false }
            : { type: "special", name: forward ? "up" : "down", shift: false };
        await this.terminal.press(key);
        this.at = { ...this.at, [axis]: this.at[axis] + (forward ? 1 : -1) };
      }
    };
    await step("file", to.file);
    await step("rank", to.rank);
  }
}

describe("the game loop", () => {
  test("cursor keys select a piece and play a legal move", async () => {
    const { opts, session, terminal } = base();
    const playing = runGame(opts);

    // Cursor starts on e4; a piece has to be selected before a target means anything.
    await terminal.press(down);
    await terminal.press(down); // e2
    await terminal.press(select); // select e2
    await terminal.press(up);
    await terminal.press(up); // back to e4
    await terminal.press(select); // play e2-e4

    expect(session.status().history.map((p) => p.san)).toEqual(["e4"]);
    await terminal.press(char("q"));
    await playing;
  });

  test("an illegal destination is refused with a notice, not a guessed move", async () => {
    const { opts, session, terminal } = base();
    const playing = runGame(opts);

    await terminal.press(down);
    await terminal.press(down); // e2
    await terminal.press(select);
    await terminal.press(char("?"));
    await terminal.press(char("?")); // dismiss help
    // e2 to e5 is not a pawn move; nothing may reach the board.
    await terminal.press(up);
    await terminal.press(up);
    await terminal.press(up);
    await terminal.press(select);

    expect(session.status().history).toHaveLength(0);
    expect(terminal.last).toContain("not legal");
    await terminal.press(char("q"));
    await playing;
  });

  test("an engine seat moves on its own before the first keypress", async () => {
    const { opts, session, terminal } = base({
      seatOf: { white: { kind: "engine" }, black: { kind: "human" } },
      engine: engineSeat("d2d4"),
    });
    const playing = runGame(opts);
    await Bun.sleep(0);
    await Bun.sleep(0);

    expect(session.status().history.map((p) => p.san)).toEqual(["d4"]);
    await terminal.press(char("q"));
    await playing;
  });

  test("plays a real game against the built-in engine with nothing installed", async () => {
    // This is the whole point of the built-in: no Stockfish, no process, no install.
    // The seat is the real engine doing a real search, not a scripted fake.
    const { opts, session, terminal } = base({
      seatOf: { white: { kind: "human" }, black: { kind: "engine" } },
      labelOf: { white: "you", black: "built-in · level 4" },
      engine: createBuiltin(4),
      level: 4,
      levelElo: 750,
    });
    const playing = runGame(opts);

    await terminal.press(down);
    await terminal.press(down); // e2
    await terminal.press(select);
    await terminal.press(up);
    await terminal.press(up); // e4
    await terminal.press(select);

    for (let i = 0; i < 600 && session.status().history.length < 2; i++) await Bun.sleep(5);

    const history = session.status().history.map((p) => p.san);
    expect(history[0]).toBe("e4");
    expect(history).toHaveLength(2);
    expect(terminal.last).toContain("built-in");
    await terminal.press(char("q"));
    await playing;
  });

  test("a model that names an illegal move falls back to the engine", async () => {
    const asked: string[] = [];
    const badModel: Seat = {
      kind: "model",
      name: "test/model",
      chat: async () => {
        asked.push("called");
        return '{"move":"Zz9"}';
      },
    };
    const { opts, session, terminal } = base({
      seatOf: { white: badModel, black: { kind: "human" } },
      engine: engineSeat("g1f3"),
    });
    const playing = runGame(opts);
    await Bun.sleep(0);
    await Bun.sleep(0);

    // The model was asked, its answer was rejected, and the engine took the ply.
    expect(asked).toHaveLength(2); // one retry, then give up
    expect(session.status().history.map((p) => p.san)).toEqual(["Nf3"]);
    expect(terminal.last).toContain("engine moved instead");
    await terminal.press(char("q"));
    await playing;
  });

  test("a grounded model move is played as the model chose it", async () => {
    const model: Seat = {
      kind: "model",
      name: "test/model",
      chat: async () => '{"move":"c4","comment":"the English"}',
    };
    const { opts, session, terminal } = base({ seatOf: { white: model, black: { kind: "human" } }, engine: null });
    const playing = runGame(opts);
    await Bun.sleep(0);
    await Bun.sleep(0);

    expect(session.status().history.map((p) => p.san)).toEqual(["c4"]);
    expect(terminal.last).toContain("the English");
    await terminal.press(char("q"));
    await playing;
  });

  test("the engine's reply is on screen before the player presses another key", async () => {
    // Measured before the fix: after `e4 Nc6` the frame still showed "black to move"
    // and a board without the knight, until an unrelated keypress repainted it.
    const { opts, session, terminal } = base({
      seatOf: { white: { kind: "human" }, black: { kind: "engine" } },
      labelOf: { white: "you", black: "built-in · level 4" },
      engine: createBuiltin(4),
      level: 4,
      levelElo: 750,
    });
    const playing = runGame(opts);

    await terminal.press(down);
    await terminal.press(down); // e2
    await terminal.press(select);
    await terminal.press(up);
    await terminal.press(up); // e4
    await terminal.press(select);

    const reply = () => session.status().history[1];
    for (let i = 0; i < 600 && !reply(); i++) await Bun.sleep(5);
    const ply = reply();
    expect(ply).toBeDefined();

    // No key has been pressed since: the frame itself must show the new position.
    expect(terminal.last).toContain("white to move");
    expect(terminal.last).toContain(ply!.san);
    await terminal.press(char("q"));
    await playing;
  });

  test("h moves the cursor left; the hint is on shift+H", async () => {
    const { opts, terminal } = base({
      seatOf: { white: { kind: "human" }, black: { kind: "engine" } },
      engine: engineSeat("g1f3"),
    });
    const playing = runGame(opts);

    // Cursor starts on e4; two h presses put it on c4, so selecting twice asks for
    // c4-d4 and the refusal names the squares the cursor actually visited.
    await terminal.press(char("h"));
    await terminal.press(select);
    await terminal.press(char("h"));
    await terminal.press(select);
    expect(terminal.last).toContain("d4-c4 is not legal");
    expect(terminal.last).not.toContain("engine suggests");

    await terminal.press({ type: "char", ch: "H", ctrl: false, shift: true });
    expect(terminal.last).toContain("engine suggests g1f3");
    await terminal.press(char("q"));
    await playing;
  });

  test("a whole game runs to checkmate on the keyboard alone", async () => {
    // The question this answers: after choosing a level, can a person play a full
    // game? Every move here goes through the cursor and space, as a player's would.
    const { opts, session, terminal } = base({
      seatOf: { white: { kind: "human" }, black: { kind: "engine" } },
      labelOf: { white: "you", black: "built-in · level 1" },
      engine: createBuiltin(1),
      level: 1,
      levelElo: 800,
    });
    const playing = runGame(opts);
    const me = new Player(terminal);
    const until = async (ok: () => boolean, what: string): Promise<void> => {
      for (let i = 0; i < 2000; i++) {
        if (ok()) return;
        await Bun.sleep(2);
      }
      throw new Error(`timed out waiting for ${what}`);
    };
    const myTurn = () => session.status().turn === "w" || session.status().over;

    for (let guard = 0; guard < 200 && !session.status().over; guard++) {
      const st = session.status();
      if (st.turn !== "w") {
        await until(myTurn, "the engine's reply");
        continue;
      }
      const best = searchRoot(Position.fromFen(st.fen), { maxDepth: 3, movetime: 2000, multiPv: 1 })[0]!;
      await me.move(moveToUci(best.move));
      await until(myTurn, "the engine's reply");
    }

    const st = session.status();
    expect(st.over).toBe(true);
    expect(st.outcome).toEqual({ reason: "checkmate", winner: "w" });
    expect(st.result).toBe("1-0");
    expect(terminal.last).toContain("white wins by checkmate");
    expect(session.pgn()).toContain('[Result "1-0"]');
    await terminal.press(char("q"));
    await playing;
  });

  test("the help screen lists only keys the loop actually handles", () => {
    // A registry on purpose: the overlay used to promise t, c, tab, m, d, p and
    // ctrl+r, none of which `handle` implements. Editing this list has to be a
    // deliberate act, made together with the handler.
    expect(HELP.map(([key]) => key)).toEqual([
      "↑ ↓ ← → / h j k l",
      "space / enter",
      "esc",
      "u",
      "H",
      "s",
      "r",
      "?",
      "q",
    ]);
  });

  test("help toggles and the frame changes with it", async () => {
    const { opts, terminal } = base();
    const playing = runGame(opts);
    await terminal.press(char("?"));
    expect(terminal.last).toContain("Help");
    await terminal.press(char("?"));
    expect(terminal.last).toContain("tokenmate · level");
    await terminal.press(char("q"));
    await playing;
  });
});

describe("setup menu: choose a level without reading --help", () => {
  const levelOptions = (n = 20) =>
    Array.from({ length: n }, (_, i) => ({ label: `Level ${i + 1}`, note: `${300 + i * 100} Elo` }));

  test("every line is exactly the window width and the borders hold", () => {
    for (const [cols, h] of [
      [96, 37],
      [80, 24],
      [40, 12],
      [20, 8],
    ] as [number, number][]) {
      const grid = setupScreen({ cols, rows: h, theme: themes[0]!, title: "Level", options: levelOptions(), selected: 7 });
      for (const line of grid.toText().split("\n")) expect(displayWidth(line)).toBe(cols);
    }
  });

  test("the list follows the selection, so level 20 is reachable on a short terminal", () => {
    const text = setupScreen({ cols: 80, rows: 24, theme: themes[0]!, title: "Level", options: levelOptions(), selected: 19 }).toText();
    expect(text).toContain("Level 20");
    // and it scrolled rather than truncating: level 1 is off-screen by then
    expect(text).not.toMatch(/\bLevel 1\b/);
  });

  test("the menu returns the level that was chosen, not the default", async () => {
    const terminal = new FakeTerminal();
    const running = runSetup(terminal, { level: 1, color: "white", theme: "slate" });
    await Bun.sleep(0);
    await terminal.press(down); // Play -> Level
    await terminal.press({ type: "special", name: "enter", shift: false });
    await terminal.press(down); // level 1 -> level 2
    await terminal.press({ type: "special", name: "enter", shift: false }); // back to the menu
    await terminal.press(up); // Level -> Play
    await terminal.press({ type: "special", name: "enter", shift: false });
    const chosen = await running;
    expect(chosen?.level).toBe(2);
  });

  test("the menu shows each level with the Elo it plays", async () => {
    const terminal = new FakeTerminal();
    const running = runSetup(terminal, { level: 8, color: "white", theme: "slate" });
    await Bun.sleep(0);
    await terminal.press(down);
    await terminal.press({ type: "special", name: "enter", shift: false });
    // The level list is a real ladder: 300 Elo at level 1, and native levels above
    expect(terminal.last).toContain("Level 1");
    expect(terminal.last).toContain("300 Elo");
    await terminal.press(char("q"));
    expect(await running).toBeNull();
  });

  test("quitting the menu starts no game", async () => {
    const terminal = new FakeTerminal();
    const running = runSetup(terminal, { level: 8, color: "white", theme: "slate" });
    await Bun.sleep(0);
    await terminal.press(char("q"));
    expect(await running).toBeNull();
  });

  test("a level chosen in the menu is the level the game actually plays", async () => {
    const terminal = new FakeTerminal();
    const running = runSetup(terminal, { level: 1, color: "white", theme: "slate" });
    await Bun.sleep(0);
    await terminal.press(down);
    await terminal.press({ type: "special", name: "enter", shift: false });
    await terminal.press(down);
    await terminal.press({ type: "special", name: "enter", shift: false });
    await terminal.press(up);
    await terminal.press({ type: "special", name: "enter", shift: false });
    const chosen = await running;
    expect(chosen?.level).toBe(2);

    const seat = createBuiltin(chosen!.level);
    const { opts, terminal: game } = base({
      seatOf: { white: { kind: "human" }, black: { kind: "engine" } },
      labelOf: { white: "you", black: `built-in · level ${chosen!.level}` },
      engine: seat,
      level: chosen!.level,
      levelElo: seat.settings.elo ?? 0,
    });
    const playing = runGame(opts);
    await Bun.sleep(0);
    expect(game.last).toContain("level 2");
    expect(game.last).toContain("(450 elo)");
    await game.press(char("q"));
    await playing;
  });
});

describe("terminal keys and colour", () => {
  test("arrows, hjkl and modified keys normalise apart", () => {
    expect(normalizeKey({ name: "up" })).toEqual({ type: "special", name: "up", shift: false });
    expect(normalizeKey({ name: "h", sequence: "h" })).toEqual({ type: "char", ch: "h", ctrl: false, shift: false });
    expect(normalizeKey({ name: "c", ctrl: true })).toEqual({ type: "char", ch: "c", ctrl: true, shift: false });
    expect(normalizeKey({ sequence: " ", name: "space" })).toEqual({ type: "special", name: "space", shift: false });
    expect(normalizeKey({ sequence: "\r", name: "return" })).toEqual({ type: "special", name: "enter", shift: false });
    // A bare "?" must survive, because it is the help key.
    expect(normalizeKey({ sequence: "?", name: "?" })).toEqual({ type: "char", ch: "?", ctrl: false, shift: false });
    expect(normalizeKey({ sequence: "/", name: "/", shift: true })).toEqual({ type: "char", ch: "?", ctrl: false, shift: true });
    expect(normalizeKey({ sequence: "\u0000", name: undefined })).toBeNull();
  });

  test("a pty reporting 0 columns is treated as unknown, not as a 1-column window", () => {
    const make = (columns: number | undefined, rows: number | undefined) =>
      new PlainTerminal({
        stdin: { on() {}, off() {}, setRawMode() {}, isTTY: true } as never,
        stdout: { columns, rows, on() {}, off() {}, write() {} } as never,
        env: { TERM: "xterm-256color" },
      });
    // Measured: under `script -q /dev/null` the pty reports 0, which `?? 80` let
    // through and collapsed the whole screen to one column.
    expect(make(0, 0).size()).toEqual({ cols: 80, rows: 24 });
    expect(make(undefined, undefined).size()).toEqual({ cols: 80, rows: 24 });
    expect(make(96, 37).size()).toEqual({ cols: 96, rows: 37 });
  });

  test("NO_COLOR wins, unknown TERM drops to 256, truecolor is earned", () => {
    expect(colorModeOf({ NO_COLOR: "1", COLORTERM: "truecolor", TERM: "xterm-256color" })).toBe("none");
    expect(colorModeOf({ TERM: "dumb" })).toBe("none");
    expect(colorModeOf({})).toBe("none");
    expect(colorModeOf({ TERM: "xterm" })).toBe("256");
    expect(colorModeOf({ TERM: "xterm-256color" })).toBe("256");
    expect(colorModeOf({ TERM: "xterm-256color", COLORTERM: "truecolor" })).toBe("truecolor");
    expect(colorModeOf({ TERM: "xterm-256color", TERM_PROGRAM: "iTerm.app" })).toBe("truecolor");
  });
});

describe("chat transport", () => {
  test("a provider ref splits on the first slash only", () => {
    expect(splitRef("ollama/qwen3")).toEqual({ provider: "ollama", model: "qwen3" });
    expect(splitRef("openrouter/anthropic/claude-3.5")).toEqual({ provider: "openrouter", model: "anthropic/claude-3.5" });
    expect(() => splitRef("noslash")).toThrow(/provider\/model/);
  });

  test("a provider whose API is not OpenAI-shaped is refused by name", () => {
    expect(() =>
      makeChat({ providerId: "anthropic", providerName: "Anthropic", model: "claude", key: "k" }),
    ).toThrow(/not OpenAI-compatible/);
  });

  test("a cloud provider with no key is refused before any request", () => {
    expect(() => makeChat({ providerId: "openai", providerName: "OpenAI", model: "gpt", key: null })).toThrow(
      ChatConfigError,
    );
  });

  test("a local provider needs neither key nor catalogue entry", async () => {
    let url = "";
    const chat = makeChat(
      { providerId: "ollama", providerName: "Ollama", model: "qwen3", key: null },
      {
        fetch: async (u) => {
          url = u;
          return new Response(JSON.stringify({ choices: [{ message: { content: '{"move":"e4"}' } }] }), {
            headers: { "content-type": "application/json" },
          });
        },
      },
    );
    const text = await chat([{ role: "user", content: "go" }]);
    expect(url).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(text).toBe('{"move":"e4"}');
  });

  test("an HTTP error is reported with its status and carries no key", async () => {
    const chat = makeChat(
      { providerId: "openai", providerName: "OpenAI", model: "gpt", key: "sk-secret-value" },
      { fetch: async () => new Response("unauthorized", { status: 401 }) },
    );
    const err = await chat([{ role: "user", content: "x" }]).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("401");
    expect((err as Error).message).not.toContain("sk-secret-value");
  });
});

const facts = (over: Partial<DoctorFacts> = {}): DoctorFacts => ({
  version: "0.1.0",
  bun: "1.4.2",
  platform: "darwin-arm64",
  terminal: { cols: 96, rows: 37, colorMode: "truecolor" },
  engine: { source: "path", cmd: ["/usr/local/bin/stockfish"], id: "Stockfish 16", probe: { hasUciElo: true, uciElo: { min: 1320, max: 3190 }, hasSkillLevel: true, skillLevel: { min: 0, max: 20 }, hasMultiPV: true, multipvMax: 500 }, error: null },
  catalog: { providers: 324, models: 10018, stale: false, fetchedAt: 1_700_000_000_000, error: null },
  local: { providers: [], missing: [{ id: "ollama", error: "connect ECONNREFUSED" }] },
  config: { path: "/home/u/.config/tokenmate/config.json", problems: [], keys: [] },
  cache: { dir: "/home/u/.tokenmate/cache", entries: 1, bytes: 2048 },
  save: { path: "/home/u/.tokenmate/last-game.json", exists: false },
  ...over,
});

describe("doctor", () => {
  test("reports every gathered fact and names the engine's source", () => {
    const text = doctorReport(facts()).join("\n");
    expect(text).toContain("tokenmate 0.1.0");
    expect(text).toContain("Stockfish 16");
    expect(text).toContain("UCI_Elo 1320–3190");
    expect(text).toContain("324 providers, 10018 models");
    expect(text).toContain("1 file,");
    expect(text).toContain("no saved game");
  });

  test("a missing UCI engine is reported as optional, not as a broken app", () => {
    const text = doctorReport(
      facts({
        engine: { source: null, cmd: [], id: null, probe: null, error: "no UCI engine found\ninstall it (darwin): brew install stockfish" },
      }),
    ).join("\n");
    // The built-in engine is what makes `play` work with nothing installed, so the
    // absence of Stockfish is an upgrade opportunity rather than an error state.
    expect(text).toContain("built-in — always available");
    expect(text).toContain("uci engine — not found; optional");
    expect(text).not.toContain("missing —");
    // The install hint is indented under the message, not jammed onto one line.
    expect(text).toContain("\n  install it (darwin): brew install stockfish");
  });

  test("a build that cannot reach the top level says so", () => {
    const text = doctorReport(
      facts({
        engine: {
          source: "path",
          cmd: ["sf"],
          id: "Stockfish 14",
          probe: { hasUciElo: true, uciElo: { min: 1320, max: 2500 }, hasSkillLevel: true, skillLevel: { min: 0, max: 20 }, hasMultiPV: true, multipvMax: 500 },
          error: null,
        },
      }),
    ).join("\n");
    // Levels are only honest if the engine can reach them.
    expect(text).toMatch(/caps at 2500 Elo, so levels above \d+ cannot reach/);
  });

  test("keys are printed redacted, never in full", () => {
    const text = doctorReport(
      facts({ config: { path: "/c.json", problems: [], keys: [{ provider: "openai (OPENAI_API_KEY)", key: "sk-abcdefghijkl" }] } }),
    ).join("\n");
    expect(text).not.toContain("sk-abcdefghijkl");
    // redact() keeps a 3-character prefix and a 2-character suffix: enough to tell
    // two keys apart, not enough to be a key.
    expect(text).toContain("sk-…kl");
    expect(text).toMatch(/sk-\u2026[a-z]{2}/);
  });
});

describe("promotion picker", () => {
  // FEN with a white pawn on e7 ready to promote
  const PROMO_FEN = "8/4P1k1/8/8/8/8/8/4K3 w - - 0 1";

  test("moving a pawn to the last rank opens the promotion picker instead of auto-queening", async () => {
    const session = Session.newGame({ fen: PROMO_FEN });
    const terminal = new FakeTerminal();
    const playing = runGame({
      session,
      terminal,
      theme: themes[0]!,
      seatOf: { white: { kind: "human" }, black: { kind: "human" } },
      labelOf: { white: "you", black: "you" },
      engine: null,
      level: 1,
      levelElo: 300,
      depth: null,
    });
    await Bun.sleep(0);

    // Navigate to e7 (the pawn) — cursor starts at e4, so go up 3
    await terminal.press({ type: "special", name: "up", shift: false });
    await terminal.press({ type: "special", name: "up", shift: false });
    await terminal.press({ type: "special", name: "up", shift: false });
    await terminal.press(select); // select e7

    // Navigate to e8 (promotion square)
    await terminal.press({ type: "special", name: "up", shift: false });
    await terminal.press(select); // try to move to e8

    // The promotion picker should be open — the notice should show the choices
    expect(terminal.last).toContain("Queen");
    expect(terminal.last).toContain("Rook");
    expect(terminal.last).toContain("Bishop");
    expect(terminal.last).toContain("Knight");

    // The pawn should NOT have moved yet
    expect(session.status().fen).toContain("4P1"); // pawn still on 7th rank

    // Press right to select Rook, then confirm
    await terminal.press({ type: "special", name: "right", shift: false });
    await terminal.press(select);

    // Now the pawn should have promoted to a rook
    expect(session.status().fen).toContain("4R"); // rook on 8th rank
    expect(session.status().fen).not.toContain("4P1"); // pawn gone

    await terminal.press(char("q")); // quit
    await playing;
  });

  test("typing a piece letter directly promotes without arrows", async () => {
    const session = Session.newGame({ fen: PROMO_FEN });
    const terminal = new FakeTerminal();
    const playing = runGame({
      session,
      terminal,
      theme: themes[0]!,
      seatOf: { white: { kind: "human" }, black: { kind: "human" } },
      labelOf: { white: "you", black: "you" },
      engine: null,
      level: 1,
      levelElo: 300,
      depth: null,
    });
    await Bun.sleep(0);

    // Navigate to e7, select, navigate to e8, select
    for (let i = 0; i < 3; i++) await terminal.press({ type: "special", name: "up", shift: false });
    await terminal.press(select);
    await terminal.press({ type: "special", name: "up", shift: false });
    await terminal.press(select);

    // Picker is open — type 'n' for knight
    await terminal.press(char("n"));

    // Should have promoted to a knight
    expect(session.status().fen).toContain("4N"); // knight on 8th rank

    await terminal.press(char("q"));
    await playing;
  });

  test("esc does not cancel — a pawn must promote", async () => {
    const session = Session.newGame({ fen: PROMO_FEN });
    const terminal = new FakeTerminal();
    const playing = runGame({
      session,
      terminal,
      theme: themes[0]!,
      seatOf: { white: { kind: "human" }, black: { kind: "human" } },
      labelOf: { white: "you", black: "you" },
      engine: null,
      level: 1,
      levelElo: 300,
      depth: null,
    });
    await Bun.sleep(0);

    for (let i = 0; i < 3; i++) await terminal.press({ type: "special", name: "up", shift: false });
    await terminal.press(select);
    await terminal.press({ type: "special", name: "up", shift: false });
    await terminal.press(select);

    // Picker is open
    expect(terminal.last).toContain("Queen");

    // Press escape — should be ignored, picker stays open
    await terminal.press({ type: "special", name: "escape", shift: false });

    // Picker is still open
    expect(terminal.last).toContain("Queen");
    expect(terminal.last).toContain("promote:");

    // Pawn still on e7
    expect(session.status().fen).toContain("4P1");

    // Now actually promote to finish the test
    await terminal.press(char("q"));
    await terminal.press(char("q")); // quit
    await playing;
  });
});

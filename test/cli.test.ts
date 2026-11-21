import { describe, expect, test } from "bun:test";
import { runGame, type EngineSeat, type Seat } from "../src/cli/play";
import { Session } from "../src/game/session";
import { themes } from "../src/ui/theme";
import { colorModeOf, normalizeKey, type Key, type Size, type Terminal } from "../src/terminal";
import { doctorReport, type DoctorFacts } from "../src/cli/doctor";
import type { ColorMode } from "../src/ui/ansi";
import type { Settings } from "../src/engine/any-uci";
import { makeChat, splitRef, ChatConfigError } from "../src/models/chat";

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

  test("a missing engine says so without pretending the app is broken", () => {
    const text = doctorReport(
      facts({
        engine: { source: null, cmd: [], id: null, probe: null, error: "no UCI engine found\ninstall it (darwin): brew install stockfish" },
      }),
    ).join("\n");
    expect(text).toContain("missing — no UCI engine found");
    // The install hint is indented under the message, not jammed onto one line.
    expect(text).toContain("\n  install it (darwin): brew install stockfish");
    expect(text).toContain("board, replay and import do not");
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

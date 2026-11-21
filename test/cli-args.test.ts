import { describe, expect, test } from "bun:test";
import { parseArgs, parseClock, HELP_TEXT, LEVELS } from "../src/cli/args";

const ok = (argv: string[]) => {
  const r = parseArgs(argv);
  if (!r.ok) throw new Error(`expected ok, got: ${r.message}`);
  return r.command;
};
const err = (argv: string[]) => {
  const r = parseArgs(argv);
  if (r.ok) throw new Error("expected a parse error, got a command");
  return r.message;
};

describe("levels", () => {
  test("defaults to level 8", () => {
    const c = ok([]);
    expect(c.cmd).toBe("play");
    if (c.cmd === "play") expect(c.opts.level).toBe(8);
  });

  test("accepts both ends of the ladder", () => {
    for (const lvl of [LEVELS.min, LEVELS.max]) {
      const c = ok(["--level", String(lvl)]);
      if (c.cmd === "play") expect(c.opts.level).toBe(lvl);
    }
  });

  test("rejects out-of-range and non-integer levels", () => {
    expect(err(["--level", "0"])).toContain("1 to 20");
    expect(err(["--level", "21"])).toContain("1 to 20");
    expect(err(["--level", "7.5"])).toContain("integer");
    expect(err(["--level"])).toContain("needs a value");
  });

  test("REFUSES named difficulty presets — a level is a level", () => {
    // The owner explicitly rejected easy/medium/hard/magnus. This test is the
    // guard that keeps that decision from quietly coming back.
    for (const name of ["easy", "medium", "hard", "magnus", "beginner"]) {
      expect(err(["--level", name])).toContain("1 to 20");
    }
    expect(HELP_TEXT).not.toContain("magnus");
    expect(HELP_TEXT.toLowerCase()).not.toContain("difficulty");
  });
});

describe("engine", () => {
  test("keeps a command with arguments as one value", () => {
    const c = ok(["--engine", "gnuchess --uci"]);
    if (c.cmd === "play") expect(c.opts.engine).toBe("gnuchess --uci");
  });

  test("a path works too", () => {
    const c = ok(["--engine", "/opt/homebrew/bin/stockfish"]);
    if (c.cmd === "play") expect(c.opts.engine).toBe("/opt/homebrew/bin/stockfish");
  });
});

describe("clock", () => {
  test("parses minutes and increment", () => {
    expect(parseClock("5+3")).toEqual({ initialMs: 300_000, incrementMs: 3_000 });
    expect(parseClock("10")).toEqual({ initialMs: 600_000, incrementMs: 0 });
    expect(parseClock("0.5+1")).toEqual({ initialMs: 30_000, incrementMs: 1_000 });
  });

  test("none means no clock", () => {
    expect(parseClock("none")).toBeNull();
  });

  test("rejects nonsense", () => {
    expect(() => parseClock("five")).toThrow(/look like/);
    expect(() => parseClock("0+3")).toThrow(/positive/);
  });
});

describe("opponent modes", () => {
  test("a model takes the seat it implies", () => {
    const c = ok(["--model", "anthropic/claude-haiku-5"]);
    if (c.cmd === "play") {
      expect(c.opts.model).toBe("anthropic/claude-haiku-5");
      expect(c.opts.opponent).toBe("model");
    }
  });

  test("model mode without a model is an error, not a silent engine game", () => {
    expect(err(["--opponent", "model"])).toContain("needs --model");
  });

  test("spectate needs two models", () => {
    expect(err(["--spectate"])).toContain("needs --model");
    expect(err(["--spectate", "--model", "a/b"])).toContain("two models");
    const c = ok(["--spectate", "--model", "a/b,c/d"]);
    if (c.cmd === "play") expect(c.opts.opponent).toBe("model-vs-model");
  });

  test("an unknown opponent mode is rejected", () => {
    expect(err(["--opponent", "human"])).toContain("engine, model");
  });
});

describe("colour, seed, depth, theme", () => {
  test("validates colour", () => {
    expect(err(["--color", "green"])).toContain("white, black or random");
    const c = ok(["--color", "black"]);
    if (c.cmd === "play") expect(c.opts.color).toBe("black");
  });

  test("seed must be an integer so a game is reproducible", () => {
    expect(err(["--seed", "abc"])).toContain("integer");
    const c = ok(["--seed", "42"]);
    if (c.cmd === "play") expect(c.opts.seed).toBe(42);
  });

  test("depth is bounded", () => {
    expect(err(["--depth", "0"])).toContain("1 to 40");
    expect(err(["--depth", "99"])).toContain("1 to 40");
  });

  test("theme is passed through untouched, to be validated against the skins", () => {
    const c = ok(["--theme", "neon"]);
    if (c.cmd === "play") expect(c.opts.theme).toBe("neon");
  });
});

describe("commands", () => {
  test("doctor, help and version", () => {
    expect(ok(["doctor"]).cmd).toBe("doctor");
    expect(ok(["--help"]).cmd).toBe("help");
    expect(ok(["-h"]).cmd).toBe("help");
    expect(ok(["--version"]).cmd).toBe("version");
    expect(ok(["-v"]).cmd).toBe("version");
  });

  test("import needs a known source and a user", () => {
    const c = ok(["import", "lichess", "DrNykterstein", "--limit", "3"]);
    expect(c).toEqual({ cmd: "import", source: "lichess", user: "DrNykterstein", limit: 3 });
    expect(err(["import"])).toContain("usage");
    expect(err(["import", "chess24", "someone"])).toContain("usage");
    expect(err(["import", "lichess"])).toContain("username");
    expect(err(["import", "lichess", "x", "--limit", "0"])).toContain("positive");
  });

  test("replay needs a file", () => {
    expect(ok(["replay", "game.pgn"])).toEqual({ cmd: "replay", file: "game.pgn" });
    expect(err(["replay"])).toContain("usage");
  });

  test("resume is its own command", () => {
    const c = ok(["resume"]);
    expect(c.cmd).toBe("resume");
  });

  test("an unknown flag is an error rather than being ignored", () => {
    expect(err(["--levle", "5"])).toContain('unknown option "--levle"');
  });

  test("a stray positional on play is an error", () => {
    expect(err(["banana"])).toContain("unexpected argument");
  });
});

describe("help text", () => {
  test("documents every flag the parser accepts", () => {
    for (const flag of [
      "--engine",
      "--level",
      "--model",
      "--opponent",
      "--color",
      "--clock",
      "--depth",
      "--seed",
      "--theme",
      "--no-sound",
      "--spectate",
      "--limit",
    ])
      expect(HELP_TEXT).toContain(flag);
  });
});

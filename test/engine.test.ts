import { describe, expect, test } from "bun:test";
import {
  adapt,
  analyse,
  HANDICAP_NOTE,
  candidates,
  classify,
  doctor,
  installHint,
  LEVELS,
  levelInfo,
  levelPlan,
  LineSplitter,
  pickMove,
  resolveEngine,
  seededRandom,
  splitCommand,
  strengthNote,
  toWhite,
  UciEngine,
  type Candidate,
  type InfoLine,
  type Probe,
  type Score,
} from "../src/engine/index";

// Everything below talks to a fake engine over a real pipe. There is no engine in
// this environment, and there is not meant to be one in the repo either.
const FIXTURE = `${import.meta.dir}/fixtures/fake-uci.ts`;
const command = (...args: string[]): string[] => [process.execPath, FIXTURE, ...args];
const commandLine = (...args: string[]): string => `"${process.execPath}" "${FIXTURE}" ${args.join(" ")}`;

const withEngine = async <T>(args: string[], body: (engine: UciEngine) => Promise<T>): Promise<T> => {
  const engine = new UciEngine(command(...args), { goTimeout: 3000 });
  try {
    await engine.start();
    return await body(engine);
  } finally {
    await engine.dispose();
  }
};

const messageOf = (fn: () => unknown) => {
  try {
    fn();
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// A child is not gone the instant it exits: it is a zombie until the parent reaps
// it, so "no orphan" is a poll, not a single check.
const gone = async (pid: number) => {
  for (let i = 0; i < 100; i++) {
    if (!alive(pid)) return true;
    await Bun.sleep(20);
  }
  return false;
};

const cp = (value: number): Score => ({ type: "cp", value });
const mate = (value: number): Score => ({ type: "mate", value });
const line = (depth: number, multipv: number, score: Score, pv: string[]): InfoLine => ({ depth, multipv, score, pv });

const probeOf = (o: Partial<Probe> = {}): Probe => ({
  hasUciElo: false,
  uciElo: null,
  hasSkillLevel: false,
  skillLevel: null,
  hasMultiPV: false,
  multipvMax: null,
  ...o,
});

const STOCKFISH_LIKE = probeOf({
  hasUciElo: true,
  uciElo: { min: 1320, max: 3190 },
  hasSkillLevel: true,
  skillLevel: { min: 0, max: 20 },
  hasMultiPV: true,
  multipvMax: 500,
});

describe("engine resolution", () => {
  test("--engine wins, then $TOKENMATE_ENGINE, then PATH", () => {
    const onPath = () => "/usr/local/bin/stockfish";
    expect(resolveEngine("/opt/flag-engine", { env: { TOKENMATE_ENGINE: "/opt/env-engine" }, which: onPath })).toEqual({
      cmd: ["/opt/flag-engine"],
      source: "flag",
    });
    expect(resolveEngine(undefined, { env: { TOKENMATE_ENGINE: "/opt/env-engine" }, which: onPath })).toEqual({
      cmd: ["/opt/env-engine"],
      source: "env",
    });
    expect(resolveEngine(undefined, { env: {}, which: onPath })).toEqual({
      cmd: ["/usr/local/bin/stockfish"],
      source: "path",
    });
  });

  test("a command string may carry arguments, and quotes group a path", () => {
    expect(splitCommand("/usr/bin/gnuchess --uci")).toEqual(["/usr/bin/gnuchess", "--uci"]);
    expect(splitCommand('"/opt/my engines/sf" --uci -threads 2')).toEqual(["/opt/my engines/sf", "--uci", "-threads", "2"]);
    expect(splitCommand("'/opt/my engines/sf'")).toEqual(["/opt/my engines/sf"]);
    // A Windows path's backslashes are the point: the string is the user's command,
    // not a shell script, and `C:\Program Files\sf.exe` has to survive intact.
    expect(splitCommand("C:\\Engines\\sf.exe")).toEqual(["C:\\Engines\\sf.exe"]);
    expect(splitCommand("   ")).toEqual([]);
    expect(() => splitCommand('"/opt/sf')).toThrow(/unbalanced/);
  });

  test("no engine anywhere names the exact install command for this OS", () => {
    const nothing = { env: {}, which: () => null };
    const darwin = messageOf(() => resolveEngine(undefined, { ...nothing, platform: "darwin" }));
    expect(darwin).toContain("brew install stockfish");
    expect(darwin).toContain("--engine");
    expect(darwin).toContain("TOKENMATE_ENGINE");
    expect(installHint("linux")).toContain("apt install stockfish");
    expect(installHint("linux")).toContain("dnf install stockfish");
    expect(installHint("linux")).toContain("pacman");
    expect(installHint("win32")).toContain("winget install stockfish");
    expect(installHint("win32")).toContain("choco install stockfish");
    expect(installHint("freebsd")).toContain("package manager");
  });
});

describe("uci handshake and capabilities", () => {
  test("handshake captures id name and the option lines", async () => {
    await withEngine(["--options=elo"], async (engine) => {
      expect(engine.id).toBe("FakeFish 0.1");
      expect(engine.probe()).toEqual({
        hasUciElo: true,
        uciElo: { min: 1320, max: 3190 },
        hasSkillLevel: true,
        skillLevel: { min: 0, max: 20 },
        hasMultiPV: true,
        multipvMax: 500,
      });
    });
  });

  test("an engine with no options probes as having none", async () => {
    await withEngine(["--options=none"], async (engine) => {
      // start() twice must not spawn twice or hang on a second handshake.
      const probe = await engine.start();
      expect(probe.hasUciElo).toBe(false);
      expect(probe.uciElo).toBeNull();
      expect(probe.hasSkillLevel).toBe(false);
      expect(probe.hasMultiPV).toBe(false);
      expect(probe.multipvMax).toBeNull();
    });
  });

  test("Skill Level without UCI_Elo is reported as exactly that", async () => {
    await withEngine(["--options=skill"], async (engine) => {
      const probe = engine.probe();
      expect(probe.hasSkillLevel).toBe(true);
      expect(probe.hasUciElo).toBe(false);
      expect(probe.uciElo).toBeNull();
    });
  });
});

describe("go, bestmove and info", () => {
  test("go returns the scripted bestmove with its info lines", async () => {
    await withEngine(["--options=elo"], async (engine) => {
      await engine.newGame();
      await engine.position("startpos", ["e2e4", "e7e5"]);
      const result = await engine.go({ multiPv: 3, movetime: 200 });
      expect(result.bestmove).toBe("e2e4");
      expect(result.info.map((l) => l.multipv)).toEqual([1, 2, 3]);
      expect(result.info.map((l) => l.score)).toEqual([cp(34), cp(12), cp(-20)]);
      expect(result.info[0]?.pv).toEqual(["e2e4", "e7e5", "g1f3"]);
      expect(result.info[0]?.depth).toBe(12);
    });
  });

  test("a null-move bestmove is reported as the engine sent it", async () => {
    await withEngine(["--options=elo", "--bestmove=0000"], async (engine) => {
      expect((await engine.go()).bestmove).toBe("0000");
    });
  });

  test("a mate score survives the pipe and is normalised for white", async () => {
    await withEngine(["--options=elo", "--mate"], async (engine) => {
      const result = await engine.go();
      expect(result.info[0]?.score).toEqual(mate(3));
      expect(analyse(result.bestmove, result.info, "w").eval).toEqual(mate(3));
      expect(analyse(result.bestmove, result.info, "w").loss).toBe(0);
    });
  });

  test("a slow engine still answers inside the deadline", async () => {
    await withEngine(["--options=elo", "--slow=150"], async (engine) => {
      const started = Date.now();
      expect((await engine.go()).bestmove).toBe("e2e4");
      expect(Date.now() - started).toBeGreaterThanOrEqual(140);
    });
  });

  test("a line split across two reads still parses", () => {
    // The one thing a chunk-based reader gets wrong: a pipe splits wherever it likes.
    const lines: string[] = [];
    const splitter = new LineSplitter((l) => lines.push(l));
    const encode = (s: string) => new TextEncoder().encode(s);
    splitter.push(encode("info depth 3 score cp 1"));
    expect(lines).toEqual([]);
    splitter.push(encode("2 pv e2e4\nbestmove e2e4\r\n"));
    expect(lines).toEqual(["info depth 3 score cp 12 pv e2e4", "bestmove e2e4"]);
    splitter.push(encode("id name Fake"));
    splitter.flush();
    expect(lines).toEqual(["info depth 3 score cp 12 pv e2e4", "bestmove e2e4", "id name Fake"]);
  });
});

describe("timeouts and teardown", () => {
  test("a go that never answers rejects instead of hanging", async () => {
    const engine = new UciEngine(command("--options=elo", "--hang"), { goTimeout: 250 });
    try {
      await engine.start();
      const started = Date.now();
      let message = "";
      try {
        await engine.go();
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      expect(message).toContain("bestmove");
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      await engine.dispose();
    }
  });

  test("a handshake that never arrives times out too", async () => {
    const engine = new UciEngine(command("--options=elo", "--mute"), { startTimeout: 250 });
    let message = "";
    try {
      await engine.start();
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    } finally {
      await engine.dispose();
    }
    expect(message).toContain("uciok");
  });

  test("dispose leaves no child behind, and calling it twice is a no-op", async () => {
    const engine = new UciEngine(command("--options=elo"));
    await engine.start();
    const pid = engine.pid ?? -1;
    expect(typeof engine.pid).toBe("number");
    await engine.dispose();
    await engine.dispose();
    expect(await gone(pid)).toBe(true);
    // A disposed engine refuses to pretend: no silent spawn, no stale queue.
    let message = "";
    try {
      await engine.go();
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain("not running");
    // And disposing something that never started is not an error either.
    await new UciEngine(command()).dispose();
  });
});

describe("the level ladder", () => {
  test("20 levels, numbered 1–20, and nothing else", () => {
    expect(LEVELS.map((l) => l.level)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(() => levelInfo(0)).toThrow(/1–20/);
    expect(() => levelInfo(21)).toThrow(/1–20/);
    expect(() => levelInfo(4.5)).toThrow(/1–20/);
  });

  test("strength is monotonic and 8–19 sit inside the engine's measured clamp", () => {
    const elos = LEVELS.map((l) => l.elo);
    for (let i = 1; i < 19; i++) expect(elos[i] ?? 0).toBeGreaterThan(elos[i - 1] ?? 0);
    // Level 20 is full strength, which is stronger than any UCI_Elo value, so its
    // number stays at the cap rather than inventing one above it.
    expect(elos[19]).toBe(elos[18]);

    for (const level of LEVELS.slice(7, 19)) {
      expect(level.strategy).toBe("uci-elo");
      expect(level.elo).toBeGreaterThanOrEqual(1320);
      expect(level.elo).toBeLessThanOrEqual(3190);
    }
    expect(LEVELS[18]?.elo).toBe(3190);
  });

  test("1–7 sample, and never claim a strength below what they can deliver", () => {
    for (const level of LEVELS.slice(0, 7)) {
      expect(level.strategy).toBe("sampling");
      expect(level.elo).toBeGreaterThanOrEqual(300);
      expect(level.elo).toBeLessThanOrEqual(1200);
    }
    expect(LEVELS[6]?.elo).toBe(1200);
    // The floor is 1320, so level 7 must not claim it.
    expect(LEVELS[6]?.elo).toBeLessThan(LEVELS[7]?.elo ?? 0);
    expect(levelPlan(1).multipv).toBeGreaterThan(1);
    expect(levelPlan(20).strategy).toBe("full");
    expect(levelPlan(20).spread).toBe(0);
  });
});

describe("loss-weighted sampling", () => {
  // The fixture's own candidate table: rank 1 is best and each rank below it gives
  // up more centipawns, so "worse move" is a number.
  const SCORES: [string, number][] = [
    ["e2e4", 34],
    ["d2d4", 12],
    ["g1f3", -20],
    ["c2c4", -85],
    ["f2f4", -160],
    ["a2a3", -240],
  ];
  const SAMPLE: Candidate[] = SCORES.map(([move, value]) => ({ move, score: cp(value) }));
  const lossOf = (move: string) => 34 - (SCORES.find(([m]) => m === move)?.[1] ?? 34);

  test("a fixed seed reproduces the same moves, a different seed does not", () => {
    const draws = (seed: number) => {
      const random = seededRandom(seed);
      return Array.from({ length: 40 }, () => pickMove(SAMPLE, levelPlan(4), random));
    };
    expect(draws(42)).toEqual(draws(42));
    expect(draws(42)).not.toEqual(draws(43));
    for (const move of draws(42)) expect(SCORES.some(([m]) => m === move)).toBe(true);
  });

  test("a weaker level gives up more centipawns than a stronger one", () => {
    const averageLoss = (level: number) => {
      const plan = levelPlan(level);
      const random = seededRandom(7);
      let total = 0;
      for (let i = 0; i < 2000; i++) total += lossOf(pickMove(SAMPLE, plan, random));
      return total / 2000;
    };
    // Uniform sampling over the same candidates would average ~110 cp at both ends,
    // and always picking rank 1 would average 0 at both — so this pair of bounds
    // fails for either wrong implementation.
    expect(averageLoss(1)).toBeGreaterThan(averageLoss(7));
    expect(averageLoss(1)).toBeGreaterThan(50);
    expect(averageLoss(7)).toBeLessThan(60);
  });
});

describe("adapting the ladder to the engine that is installed", () => {
  test("a native level asks for UCI_Elo inside the engine's own range", () => {
    const settings = adapt(12, STOCKFISH_LIKE);
    expect(settings.strategy).toBe("uci-elo");
    expect(settings.elo).toBe(2000);
    expect(settings.options).toEqual({ UCI_LimitStrength: true, UCI_Elo: 2000 });
    expect(settings.note).toContain("2000");
  });

  test("when the engine clamps, the reported Elo is the clamped one", () => {
    const narrow = probeOf({ hasUciElo: true, uciElo: { min: 1800, max: 2000 } });
    const high = adapt(16, narrow);
    expect(high.elo).toBe(2000);
    expect(high.options.UCI_Elo).toBe(2000);
    expect(high.note).toContain("clamped");
    const low = adapt(8, narrow);
    expect(low.elo).toBe(1800);
    expect(low.note).toContain("clamped");
  });

  test("an engine with neither option is handicapped, and says so", () => {
    const settings = adapt(12, probeOf());
    expect(settings.strategy).toBe("handicap");
    expect(settings.note).toBe(HANDICAP_NOTE);
    expect(HANDICAP_NOTE).toContain("engine has no UCI_Elo");
    expect(HANDICAP_NOTE).toContain("depth handicap");
    expect(HANDICAP_NOTE).toContain("strength is approximate");
    expect(settings.go.depth ?? 0).toBeGreaterThan(0);
    expect(strengthNote(probeOf())).toBe(HANDICAP_NOTE);
  });

  test("Skill Level carries the level when there is no UCI_Elo", () => {
    const skillOnly = probeOf({ hasSkillLevel: true, skillLevel: { min: 0, max: 20 }, hasMultiPV: true });
    expect(adapt(8, skillOnly).options["Skill Level"]).toBe(7);
    expect(adapt(19, skillOnly).options["Skill Level"]).toBe(19);
    expect(adapt(19, skillOnly).note).toContain("strength is approximate");
  });

  test("a sampling level turns the Elo clamp off so nothing handicaps twice", () => {
    const settings = adapt(3, STOCKFISH_LIKE);
    expect(settings.strategy).toBe("sampling");
    expect(settings.options).toEqual({ UCI_LimitStrength: false });
    expect(settings.go.multiPv).toBe(8);
    expect(settings.elo).toBe(600);
    expect(settings.note).toContain("approximate");
  });

  test("a level the engine cannot sample still clamps honestly", () => {
    // No MultiPV, so loss-weighted sampling is impossible; the Elo floor is all the
    // engine has, and level 1 must report 1320 rather than its own 300.
    const noPv = probeOf({ hasUciElo: true, uciElo: { min: 1320, max: 3190 } });
    const settings = adapt(1, noPv);
    expect(settings.strategy).toBe("uci-elo");
    expect(settings.elo).toBe(1320);
    expect(settings.note).toContain("clamped");
  });

  test("level 20 is full strength, no handicap", () => {
    const settings = adapt(20, STOCKFISH_LIKE);
    expect(settings.strategy).toBe("full");
    expect(settings.options.UCI_LimitStrength).toBe(false);
    expect(settings.note).toBe("full strength, no handicap");
  });

  // The failure this catches is an adapter that assumes Stockfish: the same level
  // must come out as three different settings on three different engines.
  test("the same level adapts to the engine that is actually there", async () => {
    await withEngine(["--options=elo"], async (engine) => {
      expect(adapt(12, engine.probe()).elo).toBe(2000);
    });
    await withEngine(["--options=skill"], async (engine) => {
      expect(adapt(12, engine.probe()).strategy).toBe("skill");
      expect(strengthNote(engine.probe())).toContain("no UCI_Elo");
    });
    await withEngine(["--options=none"], async (engine) => {
      const settings = adapt(12, engine.probe());
      expect(settings.strategy).toBe("handicap");
      expect(settings.note).toBe(HANDICAP_NOTE);
    });
  });
});

describe("analysis from the search that produced the move", () => {
  test("eval is white's perspective, centipawns and mate alike", () => {
    expect(analyse("e2e4", [line(12, 1, cp(34), ["e2e4"])], "w").eval).toEqual(cp(34));
    expect(analyse("e2e4", [line(12, 1, cp(34), ["e2e4"])], "b").eval).toEqual(cp(-34));
    // Black to move and mating: white is the one who is lost.
    expect(analyse("e2e4", [line(12, 1, mate(-3), ["e2e4"])], "b").eval).toEqual(mate(3));
    expect(toWhite(mate(3), "b")).toEqual(mate(-3));
    expect(toWhite(mate(3), "w")).toEqual(mate(3));
  });

  test("the best line is the deepest rank-1 line, not the last one emitted", () => {
    const lines = [
      line(8, 1, cp(20), ["d2d4"]),
      line(12, 1, cp(34), ["e2e4", "e7e5"]),
      line(12, 2, cp(12), ["d2d4"]),
    ];
    const analysis = analyse("e2e4", lines, "w");
    expect(analysis.pv).toEqual(["e2e4", "e7e5"]);
    expect(analysis.best).toEqual({ move: "e2e4", score: cp(34) });
  });

  test("candidates take the deepest line per MultiPV rank, in rank order", () => {
    const lines = [line(6, 2, cp(-40), ["g1f3"]), line(12, 1, cp(34), ["e2e4"]), line(12, 2, cp(-20), ["c2c4"])];
    expect(candidates(lines)).toEqual([
      { move: "e2e4", score: cp(34) },
      { move: "c2c4", score: cp(-20) },
    ]);
  });

  test("verdicts change on the exact centipawn boundaries", () => {
    expect(classify(null)).toBe("unrated");
    expect(classify(0)).toBe("best");
    expect(classify(49)).toBe("best");
    expect(classify(50)).toBe("inaccuracy");
    expect(classify(99)).toBe("inaccuracy");
    expect(classify(100)).toBe("mistake");
    expect(classify(299)).toBe("mistake");
    expect(classify(300)).toBe("blunder");
    expect(classify(1200)).toBe("blunder");
  });

  test("the played move is scored against the best candidate", () => {
    const lines = [line(12, 1, cp(34), ["e2e4"]), line(12, 2, cp(-20), ["g1f3"]), line(12, 3, cp(-85), ["c2c4"])];
    const best = analyse("e2e4", lines, "w");
    expect(best.loss).toBe(0);
    expect(best.verdict).toBe("best");
    const slip = analyse("g1f3", lines, "w");
    expect(slip.loss).toBe(54);
    expect(slip.verdict).toBe("inaccuracy");
    const worse = analyse("c2c4", lines, "w");
    expect(worse.loss).toBe(119);
    expect(worse.verdict).toBe("mistake");
  });

  test("missing a mate is a blunder, not a large centipawn number", () => {
    const analysis = analyse("g1f3", [line(16, 1, mate(3), ["d1h5"]), line(16, 2, cp(120), ["g1f3"])], "w");
    expect(analysis.loss).toBe(9877);
    expect(analysis.verdict).toBe("blunder");
    expect(analysis.eval).toEqual(mate(3));
  });

  test("a move the engine never scored is unrated rather than assumed best", () => {
    const analysis = analyse("b1c3", [line(12, 1, cp(34), ["e2e4"])], "w");
    expect(analysis.loss).toBeNull();
    expect(analysis.verdict).toBe("unrated");
    expect(analysis.played).toBeNull();
  });

  test("no info at all still yields a usable eval", () => {
    const analysis = analyse(null, [], "w");
    expect(analysis.eval).toEqual(cp(0));
    expect(analysis.pv).toEqual([]);
    expect(analysis.best).toBeNull();
  });
});

describe("the gates above can fail", () => {
  // Each case below is a plausible wrong implementation, run against the same
  // assertions. If a gate cannot reject one of these, it is not a gate.
  const SCORES: [string, number][] = [
    ["e2e4", 34],
    ["d2d4", 12],
    ["g1f3", -20],
    ["c2c4", -85],
    ["f2f4", -160],
    ["a2a3", -240],
  ];
  const SAMPLE: Candidate[] = SCORES.map(([move, value]) => ({ move, score: cp(value) }));
  const lossOf = (move: string) => 34 - (SCORES.find(([m]) => m === move)?.[1] ?? 34);

  test("uniform sampling fails the level-7 loss bound", () => {
    const random = seededRandom(7);
    let total = 0;
    for (let i = 0; i < 2000; i++) {
      const picked = SAMPLE[Math.floor(random() * SAMPLE.length)] ?? SAMPLE[0];
      total += lossOf(picked?.move ?? "e2e4");
    }
    // ~110 cp: above the <60 bound the real sampler is held to.
    expect(total / 2000).toBeGreaterThan(60);
  });

  test("a classifier with the wrong boundary disagrees at 100 cp", () => {
    const naive = (loss: number | null) => (loss === null ? "unrated" : loss >= 100 ? "blunder" : "inaccuracy");
    expect(naive(100)).not.toBe(classify(100));
    expect(naive(299)).not.toBe(classify(299));
    expect(naive(300)).toBe(classify(300));
  });

  test("a chunk-is-a-line reader would return half a bestmove", () => {
    const half = "bestmove e2e4";
    const emitted: string[] = [];
    new LineSplitter((l) => emitted.push(l)).push(new TextEncoder().encode(half.slice(0, 9)));
    expect(emitted).toEqual([]);
    expect(half.slice(0, 9).split("\n").filter(Boolean)).toHaveLength(1);
  });
});

describe("doctor", () => {
  test("reports bun, the resolved command, id name and the Elo range", async () => {
    const report = await doctor({ engine: commandLine("--options=elo"), env: { TOKENMATE_ENGINE: "/nope" } });
    expect(report.found).toBe(true);
    expect(report.source).toBe("flag");
    expect(report.command ?? "").toContain("fake-uci.ts");
    expect(report.id).toBe("FakeFish 0.1");
    expect(report.uciElo).toEqual({ min: 1320, max: 3190 });
    expect(report.strength ?? "").toContain("1320–3190");
    expect(report.error).toBeNull();
    expect(report.bun.length).toBeGreaterThan(0);
  });

  test("an engine without UCI_Elo reports null rather than a guess", async () => {
    const report = await doctor({ engine: commandLine("--options=none"), env: {} });
    expect(report.uciElo).toBeNull();
    expect(report.strength).toBe(HANDICAP_NOTE);
  });

  test("never throws when nothing resolves — it reports", async () => {
    const report = await doctor({ env: {}, which: () => null, platform: "darwin" });
    expect(report.found).toBe(false);
    expect(report.error ?? "").toContain("brew install stockfish");
    expect(report.uciElo).toBeNull();
  });

  test("a binary that will not start is a finding, not a crash", async () => {
    const report = await doctor({ engine: "/definitely/not/here/engine", env: {} });
    expect(report.found).toBe(true);
    expect(report.id).toBeNull();
    expect(report.probe).toBeNull();
    expect(report.error).toBeTruthy();
  });
});

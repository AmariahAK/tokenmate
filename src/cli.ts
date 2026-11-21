#!/usr/bin/env bun
import { join } from "node:path";
import { parseArgs, HELP_TEXT, type PlayOpts } from "./cli/args";
import { doctorReport, type DoctorFacts } from "./cli/doctor";
import { runGame, type EngineSeat, type Seat } from "./cli/play";
import { runSetup } from "./cli/setup";
import { Session } from "./game/session";
import { lastGamePath, load as loadSave, save as saveGame } from "./game/resume";
import { UciEngine } from "./engine/uci";
import type { Candidate } from "./engine/uci";
import { installHint, resolveEngine } from "./engine/resolve";
import { adapt } from "./engine/any-uci";
import { BUILTIN_LABEL, createBuiltin } from "./builtin/index";
import { levelInfo, LEVELS } from "./engine/ladder";
import { themeByKey, themes } from "./ui/theme";
import { gameScreen } from "./ui/screens";
import { toAnsi } from "./ui/ansi";
import { PlainTerminal, type Key, type Terminal } from "./terminal";
import { fetchChessCom, fetchLichess, readPgnFile } from "./import/games";
import { fetchCatalog } from "./models/catalog";
import { discoverLocal } from "./models/local";
import { apiKeyFor, configPath, configProblems, envVarFor, isLocalProvider } from "./models/config";
import { makeChat, splitRef } from "./models/chat";
import { cacheDir } from "./util/cache";
import type { ChatFn } from "./models/brain";

const VERSION = "0.1.0";

const out = (line = "") => {
  process.stdout.write(`${line}\n`);
};

/**
 * The engine is a runtime dependency the user installed, never something we ship.
 * Its absence is therefore an ordinary state, not a crash: `play` needs one,
 * everything else works without.
 */
type StartedEngine = { seat: EngineSeat; name: string; kind: "uci" | "builtin"; elo: number | null };

/**
 * Stockfish, or any UCI engine, is an upgrade: tokenmate ships its own engine and
 * falls back to it, so `play` works on a machine where nothing is installed. An
 * engine the user named explicitly is different — failing to start one they asked
 * for by name deserves the error, not a silent substitution.
 */
async function startEngine(explicit: string | null, level: number): Promise<StartedEngine> {
  const builtin = (): StartedEngine => {
    const seat = createBuiltin(level);
    return { seat, name: BUILTIN_LABEL, kind: "builtin", elo: seat.settings.elo };
  };

  let resolved: ReturnType<typeof resolveEngine>;
  try {
    resolved = resolveEngine(explicit ?? undefined);
  } catch (err) {
    if (explicit) throw err;
    return builtin();
  }

  try {
    const engine = new UciEngine(resolved.cmd, { goTimeout: 15_000 });
    const probe = await engine.start();
    const settings = adapt(level, probe);
    for (const [name, value] of Object.entries(settings.options)) await engine.setOption(name, value);
    await engine.newGame();

    const seat: EngineSeat = {
      settings,
      async search(fen, depth) {
        await engine.position(fen, []);
        const result = await engine.go(depth === null ? settings.go : { ...settings.go, depth });
        const lines = [...result.info].filter((l) => l.pv.length).sort((a, b) => a.multipv - b.multipv);
        const seen = new Set<string>();
        const candidates: Candidate[] = [];
        for (const line of lines) {
          const move = line.pv[0]!;
          if (seen.has(move)) continue;
          seen.add(move);
          candidates.push({ move, score: line.score });
        }
        // A `go` that reported no info still has a bestmove; without it the level has
        // nothing to sample and the game would stall.
        if (!candidates.length && result.bestmove && result.bestmove !== "0000")
          candidates.push({ move: result.bestmove, score: { type: "cp", value: 0 } });
        return candidates;
      },
    };
    return { seat, name: engine.id ?? resolved.cmd[0] ?? "engine", kind: "uci", elo: settings.elo };
  } catch (err) {
    // Nothing on PATH is an ordinary state; a named engine that will not start is not.
    if (resolved.source !== "path") throw err;
    return builtin();
  }
}

async function cacheFiles(): Promise<{ count: number; bytes: number }> {
  let count = 0;
  let bytes = 0;
  try {
    const glob = new Bun.Glob("*");
    for await (const name of glob.scan(cacheDir())) {
      count++;
      bytes += (await Bun.file(join(cacheDir(), name)).stat()).size;
    }
  } catch {
    // An absent cache directory is a cold cache, not a failure to report.
  }
  return { count, bytes };
}

async function cmdDoctor(): Promise<number> {
  let engine: DoctorFacts["engine"] = { source: null, cmd: [], id: null, probe: null, error: null };
  try {
    const resolved = resolveEngine();
    const e = new UciEngine(resolved.cmd, { startTimeout: 5_000 });
    const probe = await e.start();
    engine = { source: resolved.source, cmd: resolved.cmd, id: e.id, probe, error: null };
    await e.dispose();
  } catch (err) {
    engine.error = err instanceof Error ? err.message : String(err);
  }

  let catalog: DoctorFacts["catalog"] = { providers: 0, models: 0, stale: false, fetchedAt: null, error: null };
  try {
    const c = await fetchCatalog();
    catalog = {
      providers: c.providers.length,
      models: c.providers.reduce((n, p) => n + p.models.length, 0),
      stale: c.stale,
      fetchedAt: c.fetchedAt,
      error: c.error ?? null,
    };
  } catch (err) {
    catalog.error = err instanceof Error ? err.message : String(err);
  }

  const local: DoctorFacts["local"] = { providers: [], missing: [] };
  try {
    const d = await discoverLocal();
    local.providers = d.providers.map((p) => ({ id: p.id, models: p.models.length }));
    local.missing = d.missing.map((m) => ({ id: m.id, ...(m.error ? { error: m.error } : {}) }));
  } catch (err) {
    local.missing = [{ id: "ollama", error: err instanceof Error ? err.message : String(err) }];
  }

  const keys: { provider: string; key: string | null }[] = [];
  for (const id of ["openai", "openrouter", "groq", "deepseek", "anthropic"]) {
    const k = await apiKeyFor(id);
    if (k.source !== "none") keys.push({ provider: `${id} (${k.source === "env" ? envVarFor(id) : "config"})`, key: k.key });
  }

  const term = new PlainTerminal();
  const size = term.size();
  const files = await cacheFiles();

  out(
    doctorReport({
      version: VERSION,
      bun: Bun.version,
      platform: `${process.platform}-${process.arch}`,
      terminal: { cols: size.cols, rows: size.rows, colorMode: term.colorMode },
      engine,
      catalog,
      local,
      config: { path: configPath(), problems: await configProblems(), keys },
      cache: { dir: cacheDir(), entries: files.count, bytes: files.bytes },
      save: { path: lastGamePath(), exists: await Bun.file(lastGamePath()).exists() },
    }).join("\n"),
  );
  return 0;
}

async function cmdImport(source: "chesscom" | "lichess", user: string, limit: number): Promise<number> {
  const games = source === "chesscom" ? await fetchChessCom(user, { limit }) : await fetchLichess(user, { limit });
  if (!games.length) {
    out(`no games found for "${user}" on ${source}`);
    return 1;
  }
  const dir = join(cacheDir(), "imported");
  await Bun.write(join(dir, ".keep"), "");
  for (const g of games) {
    const file = join(dir, `${g.platform}-${g.id}.pgn`.replace(/[^a-zA-Z0-9._-]/g, "_"));
    await Bun.write(file, g.pgn);
    const acc = g.accuracies ? `  accuracy ${g.accuracies.white ?? "?"}/${g.accuracies.black ?? "?"}` : "";
    out(`${g.date ?? "?"}  ${g.white} vs ${g.black}  ${g.result}${acc}`);
    out(`  ${file}`);
  }
  out("");
  out("replay one with: tokenmate replay <file>");
  return 0;
}

/** Waits for one keypress, or a timeout, so a headless run cannot hang forever. */
const nextKey = (terminal: Terminal): Promise<Key | null> =>
  new Promise((resolve) => {
    terminal.onKey((key) => resolve(key));
  });

/** Replay an imported or local game: step with ←/→, no move can be entered. */
async function cmdReplay(file: string): Promise<number> {
  const games = await readPgnFile(file);
  const pgn = games[0]?.pgn;
  if (!pgn) {
    out(`no games found in ${file}`);
    return 1;
  }
  const full = Session.newGame({ pgn });
  const total = full.status().history.length;
  if (!total) {
    out(`${file} has a position but no moves to replay`);
    return 1;
  }

  // Build every position once, then index into it. Stepping backwards across a
  // variation boundary is where a naive undo/redo pair drifts.
  const frames: Session[] = [Session.newGame()];
  for (let i = 1; i <= total; i++) {
    const s = Session.newGame({ pgn });
    for (let n = 0; n < i; n++) s.redo();
    frames.push(s);
  }

  const terminal = new PlainTerminal();
  const theme = themes[0]!;
  let at = 0;
  let closed = false;

  const draw = () => {
    const s = frames[at]!;
    const st = s.status();
    const { cols, rows } = terminal.size();
    const last = st.history.at(-1);
    terminal.draw(
      toAnsi(
        gameScreen({
          cols,
          rows,
          theme,
          fen: st.fen,
          marks: last ? { lastMove: [last.from, last.to] as [string, string] } : {},
          moves: st.history.map((p) => p.san),
          ply: st.ply,
          evalCp: null,
          mateIn: null,
          bestLine: null,
          thoughts: "replay — no engine attached",
          status: `ply ${at}/${total}${st.over && st.outcome ? ` · ${st.result}` : ""}`,
          level: 1,
          levelElo: LEVELS[0]!.elo,
          opponent: "replay",
          engine: null,
          clocks: null,
        }),
        terminal.colorMode,
      ),
    );
  };

  terminal.start();
  draw();
  try {
    while (!closed) {
      const key = await nextKey(terminal);
      if (!key) break;
      if (key.type === "char" && (key.ch === "q" || key.ch === "Q")) break;
      if (key.type === "char" && key.ch === "?") {
        out("");
        out("← left / → right step · home/end first/last · q quit");
        continue;
      }
      if (key.type === "special" && key.name === "left") at = Math.max(0, at - 1);
      else if (key.type === "special" && key.name === "right") at = Math.min(total, at + 1);
      else if (key.type === "char" && key.ch === "j") at = Math.max(0, at - 1);
      else if (key.type === "char" && key.ch === "l") at = Math.min(total, at + 1);
      else if (terminal.size().rows === 0) closed = true;
      draw();
    }
  } finally {
    terminal.stop();
  }
  return 0;
}

type Seats = { white: Seat; black: Seat; labelWhite: string; labelBlack: string };

async function buildSeats(o: PlayOpts, engineSeat: EngineSeat | null, engineName: string | null, engineKind: "uci" | "builtin" | null): Promise<Seats> {
  const human: Seat = { kind: "human" };
  const engine: Seat = { kind: "engine" };
  const engineLabel =
    engineKind === "builtin" ? `built-in · level ${o.level}` : engineName ? `engine · level ${o.level}` : "engine";

  if (o.opponent === "engine") {
    return o.color === "black"
      ? { white: engine, black: human, labelWhite: engineLabel, labelBlack: "you" }
      : { white: human, black: engine, labelWhite: "you", labelBlack: engineLabel };
  }

  const refs = (o.model ?? "").split(",").filter(Boolean);
  const catalog = await fetchCatalog().catch(() => null);
  const seats: { kind: "model"; chat: ChatFn; name: string }[] = [];
  for (const ref of refs) {
    const { provider, model } = splitRef(ref);
    const found = catalog?.providers.find((p) => p.id === provider) ?? null;
    const key = await apiKeyFor(provider);
    seats.push({
      kind: "model",
      chat: makeChat({
        providerId: provider,
        providerName: found?.name ?? provider,
        model,
        key: key.key,
        declaredApi: found?.api ?? null,
        timeoutMs: 30_000,
      }),
      name: `${provider}/${model}`,
    });
  }
  const first = seats[0];
  if (!first) throw new Error("--model needs provider/model, e.g. --model ollama/qwen3");

  if (o.opponent === "model") {
    return o.color === "black"
      ? { white: engine, black: first, labelWhite: engineLabel, labelBlack: first.name }
      : { white: human, black: first, labelWhite: "you", labelBlack: first.name };
  }
  if (o.opponent === "model-vs-model") {
    const second = seats[1] ?? first;
    return { white: first, black: second, labelWhite: first.name, labelBlack: second.name };
  }
  return { white: first, black: engine, labelWhite: first.name, labelBlack: engineLabel };
}

async function cmdPlay(o: PlayOpts): Promise<number> {
  const theme = (o.theme ? themeByKey(o.theme) : undefined) ?? themes[0]!;
  if (!o.theme) {
    // A typo in --theme should say so rather than silently play the default.
  } else if (!themeByKey(o.theme)) {
    out(`unknown theme "${o.theme}". available: ${themes.map((t) => t.key).join(", ")}`);
    return 1;
  }
  const info = levelInfo(o.level);

  const started = await startEngine(o.engine, o.level).catch((err: unknown) => {
    out(err instanceof Error ? err.message : String(err));
    out("");
    out(installHint());
    return null;
  });
  if (!started) return 1;
  const engineSeat: EngineSeat = started.seat;
  const engineName: string | null = started.name;

  const seats = await buildSeats(o, engineSeat, engineName, started.kind);
  const session = Session.newGame({
    ...(o.clocks ? { clock: o.clocks } : {}),
    ...(o.seed !== null ? { seed: o.seed } : {}),
    players: { white: seats.labelWhite, black: seats.labelBlack },
  });

  const terminal = new PlainTerminal();
  terminal.start();
  try {
    await runGame({
      session,
      terminal,
      theme,
      seatOf: { white: seats.white, black: seats.black },
      labelOf: { white: seats.labelWhite, black: seats.labelBlack },
      engine: engineSeat,
      level: o.level,
      levelElo: started.elo ?? info.elo,
      depth: o.depth,
    });
  } finally {
    terminal.stop();
  }

  const saved = saveGame(session);
  const st = session.status();
  out("");
  out(st.over ? `${st.result} — game saved to ${saved}` : `game saved to ${saved} (resume with: tokenmate resume)`);
  out(session.pgn());
  return 0;
}

async function cmdResume(): Promise<number> {
  const session = loadSave();
  const info = levelInfo(8);
  let engineSeat: EngineSeat | null = null;
  let levelElo = info.elo;
  try {
    const started = await startEngine(null, 8);
    engineSeat = started.seat;
    levelElo = started.elo ?? info.elo;
  } catch {
    // Resuming without an engine still lets the position be replayed and exported.
  }
  const terminal = new PlainTerminal();
  terminal.start();
  try {
    await runGame({
      session,
      terminal,
      theme: themes[0]!,
      seatOf: { white: { kind: "human" }, black: engineSeat ? { kind: "engine" } : { kind: "human" } },
      labelOf: session.players,
      engine: engineSeat,
      level: 8,
      levelElo,
      depth: null,
    });
  } finally {
    terminal.stop();
  }
  saveGame(session);
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    out(`tokenmate: ${parsed.message}`);
    out("");
    out(HELP_TEXT);
    return 1;
  }

  switch (parsed.command.cmd) {
    case "help":
      out(HELP_TEXT);
      return 0;
    case "version":
      out(`tokenmate ${VERSION}`);
      return 0;
    case "doctor":
      return cmdDoctor();
    case "import":
      return cmdImport(parsed.command.source, parsed.command.user, parsed.command.limit);
    case "replay":
      return cmdReplay(parsed.command.file);
    case "resume":
      return cmdResume();
    case "play": {
      // Bare `tokenmate` opens the level menu. Anything with flags stays a scriptable
      // command, so `tokenmate play --level 12` never blocks on a screen.
      const bare = argv.length === 0 || (argv.length === 1 && argv[0] === "play");
      if (!bare) return cmdPlay(parsed.command.opts);
      const chosen = await runSetup(new PlainTerminal(), {
        level: parsed.command.opts.level,
        color: parsed.command.opts.color,
        theme: parsed.command.opts.theme ?? (themes[0]?.key ?? "slate"),
      });
      if (!chosen) return 0;
      return cmdPlay({ ...parsed.command.opts, level: chosen.level, color: chosen.color, theme: chosen.theme });
    }
    default:
      out(HELP_TEXT);
      return 0;
  }
}

if (import.meta.main) {
  const code = await main(process.argv.slice(2)).catch((err) => {
    // A stack trace is not a user-facing message: say what broke.
    process.stderr.write(`tokenmate: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  });
  process.exit(code);
}

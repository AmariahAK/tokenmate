import { strengthNote } from "./any-uci";
import { UciEngine, type Probe } from "./uci";

// Where the engine comes from. tokenmate ships none, so this is the whole of the
// "you bring the engine" contract: three places to look, then one message that says
// exactly what to type.
export type Source = "flag" | "env" | "path";

export type Resolved = { cmd: string[]; source: Source };

export type ResolveOptions = {
  env?: Record<string, string | undefined>;
  platform?: string;
  which?: (name: string) => string | null;
};

/**
 * Splits a command string the way a shell would split a *path*, and no further:
 * quotes group, whitespace separates, and nothing else is interpreted. No backslash
 * escapes on purpose — `C:\Program Files\stockfish.exe` has to survive, and it is
 * the user's own command, not a shell script.
 */
export function splitCommand(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let started = false;
  let quote: '"' | "'" | null = null;
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) {
        out.push(cur);
        cur = "";
        started = false;
      }
      continue;
    }
    cur += ch;
    started = true;
  }
  if (quote) throw new Error(`unbalanced ${quote} quote in engine command: ${s}`);
  if (started) out.push(cur);
  return out;
}

/** The one line a user with no engine actually needs. */
export function installHint(platform: string = process.platform): string {
  switch (platform) {
    case "darwin":
      return "brew install stockfish";
    case "win32":
      return "winget install stockfish  (or: choco install stockfish)";
    case "linux":
      return "sudo apt install stockfish  (or: sudo dnf install stockfish, sudo pacman -S stockfish)";
    default:
      return "install stockfish with your system package manager";
  }
}

export function noEngineMessage(platform: string = process.platform): string {
  return [
    "no UCI engine found, and tokenmate does not bundle one — the engine is a separate program you install.",
    `install it (${platform}): ${installHint(platform)}`,
    'or point at any UCI engine: --engine "/path/to/engine", or a command with arguments: --engine "gnuchess --uci"',
    "or set $TOKENMATE_ENGINE to the same thing.",
  ].join("\n");
}

/**
 * `--engine` → `$TOKENMATE_ENGINE` → `stockfish` on `PATH`. First hit wins and the
 * report says which one it was, because "why is it playing like Stockfish 14" is a
 * question the source answers.
 */
export function resolveEngine(explicit?: string, opts: ResolveOptions = {}): Resolved {
  const env = opts.env ?? process.env;
  const which = opts.which ?? ((name: string) => Bun.which(name));

  const parse = (value: string | undefined, source: Source): Resolved | null => {
    const cmd = value?.trim() ? splitCommand(value) : [];
    return cmd.length ? { cmd, source } : null;
  };

  const flag = parse(explicit, "flag");
  if (flag) return flag;
  const fromEnv = parse(env.TOKENMATE_ENGINE, "env");
  if (fromEnv) return fromEnv;
  const onPath = which("stockfish");
  if (onPath) return { cmd: [onPath], source: "path" };
  throw new Error(noEngineMessage(opts.platform));
}

export type DoctorReport = {
  bun: string;
  platform: string;
  found: boolean;
  source: Source | null;
  /** The resolved command, joined for display. */
  command: string | null;
  /** The engine's own `id name`. */
  id: string | null;
  /** The `UCI_Elo` range the engine reports; null when it has no such option. */
  uciElo: { min: number; max: number } | null;
  probe: Probe | null;
  /** What strength the ladder can actually deliver on this engine. */
  strength: string | null;
  error: string | null;
};

export type DoctorOptions = ResolveOptions & { engine?: string; startTimeout?: number };

/**
 * Everything `tokenmate doctor` prints. It never throws: a missing engine, a binary
 * that will not start and a handshake that times out are all findings, and a doctor
 * that dies instead of reporting has told the user nothing.
 */
export async function doctor(opts: DoctorOptions = {}): Promise<DoctorReport> {
  const report: DoctorReport = {
    bun: Bun.version,
    platform: opts.platform ?? process.platform,
    found: false,
    source: null,
    command: null,
    id: null,
    uciElo: null,
    probe: null,
    strength: null,
    error: null,
  };

  let engine: UciEngine | null = null;
  try {
    const resolved = resolveEngine(opts.engine, opts);
    report.found = true;
    report.source = resolved.source;
    report.command = resolved.cmd.join(" ");
    engine = new UciEngine(resolved.cmd, { startTimeout: opts.startTimeout });
    const probe = await engine.start();
    report.id = engine.id;
    report.uciElo = probe.uciElo;
    report.probe = probe;
    report.strength = strengthNote(probe);
  } catch (e) {
    report.error = e instanceof Error ? e.message : String(e);
  } finally {
    // Not awaited outside the finally: a doctor run must not be the reason a child
    // outlives the command.
    await engine?.dispose().catch(() => {});
  }
  return report;
}

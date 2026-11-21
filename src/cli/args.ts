export type Color = "white" | "black" | "random";

export type Command =
  | { cmd: "play"; opts: PlayOpts }
  | { cmd: "doctor" }
  | { cmd: "import"; source: "chesscom" | "lichess"; user: string; limit: number }
  | { cmd: "replay"; file: string }
  | { cmd: "resume" }
  | { cmd: "help" }
  | { cmd: "version" };

export type PlayOpts = {
  engine: string | null;
  level: number;
  color: Color;
  model: string | null;
  opponent: "engine" | "model" | "model-vs-model" | "model-vs-engine";
  seed: number | null;
  depth: number | null;
  theme: string | null;
  clocks: { initialMs: number; incrementMs: number } | null;
  sound: boolean;
  spectate: boolean;
  resume: boolean;
};

export type ParseOk = { ok: true; command: Command };
export type ParseErr = { ok: false; message: string };
export type ParseResult = ParseOk | ParseErr;

export const LEVELS = { min: 1, max: 20 } as const;

export const HELP_TEXT = `tokenmate — play, watch and analyse chess in your terminal

usage
  tokenmate                       choose a level, colour and theme, then play
  tokenmate play [options]        any option skips the menu and plays straight away
  tokenmate doctor                what tokenmate found: bun, engine, models, cache
  tokenmate import <source> <user> [--limit n]
  tokenmate replay <file.pgn>
  tokenmate resume                continue the last saved game

options
  --engine <path|command>   engine to drive, e.g. --engine "gnuchess --uci"
  --level <1-20>            level 1-20; each prints the Elo it actually plays
  --model <provider/model>  a model takes a seat instead of the engine
  --opponent <mode>         engine | model | model-vs-model | model-vs-engine
  --color <white|black|random>
  --clock <minutes+increment>  e.g. --clock 5+3, or --clock none
  --depth <n>               search depth override
  --seed <n>                deterministic engine choices (reproducible levels)
  --theme <slug>            slate, wood, moss, mono, neon
  --no-sound                disable sound
  --spectate                two AIs play each other
  -h, --help                this text
  -v, --version             version

environment
  TOKENMATE_ENGINE          engine path or command, used when --engine is absent
  TOKENMATE_HOME            where cache, config and saved games live
`;

// Level is a number, never a name. The owner was explicit: no easy/medium/hard,
// and definitely no "magnus" — a person's name is not a setting.
const parseLevel = (raw: string): number => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < LEVELS.min || n > LEVELS.max)
    throw new Error(`--level must be an integer from ${LEVELS.min} to ${LEVELS.max} (got "${raw}")`);
  return n;
};

/** `5+3` is five minutes plus three seconds a move; `none` means no clocks. */
export const parseClock = (raw: string): { initialMs: number; incrementMs: number } | null => {
  if (raw === "none") return null;
  const m = /^(\d+(?:\.\d+)?)(?:\+(\d+))?$/.exec(raw);
  if (!m) throw new Error(`--clock must look like 5+3, 10, or none (got "${raw}")`);
  const minutes = Number(m[1]);
  const inc = Number(m[2] ?? 0);
  if (minutes <= 0) throw new Error("--clock needs a positive number of minutes");
  return { initialMs: Math.round(minutes * 60_000), incrementMs: inc * 1000 };
};

const OPPONENTS = ["engine", "model", "model-vs-model", "model-vs-engine"] as const;
type Opponent = (typeof OPPONENTS)[number];

export function parseArgs(argv: string[]): ParseResult {
  const opts: PlayOpts = {
    engine: null,
    level: 8,
    color: "white",
    model: null,
    opponent: "engine",
    seed: null,
    depth: null,
    theme: null,
    clocks: null,
    sound: true,
    spectate: false,
    resume: false,
  };
  let cmd: "play" | "doctor" | "import" | "replay" | "resume" | "help" | "version" = "play";
  let importSource: "chesscom" | "lichess" | null = null;
  let importUser: string | null = null;
  let importLimit = 10;
  let replayFile: string | null = null;

  const value = (args: string[], i: number, flag: string): string => {
    const v = args[i + 1];
    if (v === undefined || v.startsWith("-")) throw new Error(`${flag} needs a value`);
    return v;
  };

  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    try {
      switch (arg) {
        case "-h":
        case "--help":
          cmd = "help";
          break;
        case "-v":
        case "--version":
          cmd = "version";
          break;
        case "play":
          cmd = "play";
          break;
        case "doctor":
          cmd = "doctor";
          break;
        case "resume":
          cmd = "resume";
          opts.resume = true;
          break;
        case "import":
          cmd = "import";
          break;
        case "replay":
          cmd = "replay";
          break;
        case "--engine":
          opts.engine = value(argv, i, arg);
          i++;
          break;
        case "--level":
          opts.level = parseLevel(value(argv, i, arg));
          i++;
          break;
        case "--model":
          opts.model = value(argv, i, arg);
          i++;
          break;
        case "--opponent": {
          const v = value(argv, i, arg);
          if (!(OPPONENTS as readonly string[]).includes(v))
            throw new Error(`--opponent must be one of ${OPPONENTS.join(", ")} (got "${v}")`);
          opts.opponent = v as Opponent;
          i++;
          break;
        }
        case "--color": {
          const v = value(argv, i, arg);
          if (v !== "white" && v !== "black" && v !== "random")
            throw new Error(`--color must be white, black or random (got "${v}")`);
          opts.color = v;
          i++;
          break;
        }
        case "--clock":
          opts.clocks = parseClock(value(argv, i, arg));
          i++;
          break;
        case "--depth": {
          const v = Number(value(argv, i, arg));
          if (!Number.isInteger(v) || v < 1 || v > 40) throw new Error("--depth must be an integer from 1 to 40");
          opts.depth = v;
          i++;
          break;
        }
        case "--seed": {
          const v = Number(value(argv, i, arg));
          if (!Number.isInteger(v)) throw new Error("--seed must be an integer");
          opts.seed = v;
          i++;
          break;
        }
        case "--theme":
          opts.theme = value(argv, i, arg);
          i++;
          break;
        case "--limit": {
          const v = Number(value(argv, i, arg));
          if (!Number.isInteger(v) || v < 1) throw new Error("--limit must be a positive integer");
          importLimit = v;
          i++;
          break;
        }
        case "--no-sound":
          opts.sound = false;
          break;
        case "--spectate":
          opts.spectate = true;
          break;
        default:
          if (arg.startsWith("-")) throw new Error(`unknown option "${arg}"`);
          positional.push(arg);
      }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  if (cmd === "import") {
    const [source, user] = positional;
    if (source !== "chesscom" && source !== "lichess")
      return { ok: false, message: "usage: tokenmate import <chesscom|lichess> <user> [--limit n]" };
    if (!user) return { ok: false, message: `import from ${source} needs a username` };
    importSource = source;
    importUser = user;
  }
  if (cmd === "replay") {
    const file = positional[0];
    if (!file) return { ok: false, message: "usage: tokenmate replay <file.pgn>" };
    replayFile = file;
  }
  if (cmd === "play" && positional.length)
    return { ok: false, message: `unexpected argument "${positional[0]}" — see tokenmate --help` };

  // A model seat implies the model is the opponent unless told otherwise.
  if (opts.model && opts.opponent === "engine") opts.opponent = "model";
  if (opts.spectate) opts.opponent = "model-vs-model";
  if (cmd === "play" && (opts.opponent === "model" || opts.opponent === "model-vs-model" || opts.opponent === "model-vs-engine") && !opts.model)
    return { ok: false, message: `--opponent ${opts.opponent} needs --model <provider/model>` };
  if (cmd === "play" && opts.opponent === "model-vs-model" && opts.model && !opts.model.includes(","))
    return { ok: false, message: "model-vs-model needs two models: --model a/b,c/d" };

  switch (cmd) {
    case "help":
      return { ok: true, command: { cmd: "help" } };
    case "version":
      return { ok: true, command: { cmd: "version" } };
    case "doctor":
      return { ok: true, command: { cmd: "doctor" } };
    case "resume":
      return { ok: true, command: { cmd: "resume" } };
    case "replay":
      return { ok: true, command: { cmd: "replay", file: replayFile! } };
    case "import":
      return {
        ok: true,
        command: { cmd: "import", source: importSource!, user: importUser!, limit: importLimit },
      };
    default:
      return { ok: true, command: { cmd: "play", opts } };
  }
}

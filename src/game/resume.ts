import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { COLORS, GAME_OVER_REASONS, Session, type SessionSnapshot } from "./session";

// An interrupted game has to survive a closed terminal without ever resuming into a
// position that was never on the board, so the reader is stricter than the writer:
// unknown shape, unknown schema version and unreplayable moves all fail loudly.

/** Bumped whenever the snapshot shape changes: an old file must say so, not guess. */
export const SAVE_VERSION = 1;

export class ResumeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResumeError";
  }
}

const gameSchema = z.object({
  startFen: z.string().min(1),
  players: z.object({ white: z.string(), black: z.string() }),
  tags: z.record(z.string(), z.string()),
  seed: z.number().int(),
  moves: z.array(z.string()),
  outcome: z
    .object({ reason: z.enum(GAME_OVER_REASONS), winner: z.enum(COLORS).nullable() })
    .nullable(),
  drawOffer: z.enum(COLORS).nullable(),
  clock: z
    .object({
      initialMs: z.number().int().min(0),
      incrementMs: z.number().int().min(0),
      whiteMs: z.number().int().min(0),
      blackMs: z.number().int().min(0),
    })
    .nullable(),
});

const fileSchema = z.object({
  version: z.number().int(),
  savedAt: z.string(),
  game: gameSchema,
});

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const issues = (error: z.ZodError) => error.issues.map((i) => `${i.path.join(".") || "save"}: ${i.message}`).join("; ");

/** `$TOKENMATE_HOME` exists so tests never write into a real home directory. */
export function tokenmateHome(): string {
  const override = process.env["TOKENMATE_HOME"];
  return override && override.trim() !== "" ? override : join(homedir(), ".tokenmate");
}

export function lastGamePath(): string {
  return join(tokenmateHome(), "last-game.json");
}

/** Writes via a temp file and a rename, so a crash mid-save cannot truncate the last good one. */
export function save(session: Session, path: string = lastGamePath()): string {
  const body = { version: SAVE_VERSION, savedAt: new Date().toISOString(), game: session.snapshot() };
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(body, null, 2)}\n`);
  renameSync(temp, path);
  return path;
}

export function load(path: string = lastGamePath()): Session {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new ResumeError(`no saved game at ${path}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ResumeError(`${path} is not valid JSON: ${message(e)}`);
  }

  // Version before shape: a file from another build should say which build, not
  // "invalid save file".
  const version = (raw as { version?: unknown } | null)?.version;
  if (typeof version !== "number") throw new ResumeError(`${path} is not a tokenmate save file: no save version`);
  if (version !== SAVE_VERSION)
    throw new ResumeError(`${path} was saved by version ${version}; this build reads version ${SAVE_VERSION}`);

  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) throw new ResumeError(`${path} is not a valid save file: ${issues(parsed.error)}`);

  try {
    return Session.fromSnapshot(parsed.data.game as SessionSnapshot);
  } catch (e) {
    throw new ResumeError(`${path} cannot be resumed: ${message(e)}`);
  }
}

/** Drops the saved game; `false` when there was none. */
export function clear(path: string = lastGamePath()): boolean {
  try {
    rmSync(path);
    return true;
  } catch {
    return false;
  }
}

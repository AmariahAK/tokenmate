import { join } from "node:path";
import { homeDir } from "../util/cache";

// Keys come from the environment first. A config file is supported because
// pasting an export line into every shell gets old, but it must never be a
// convenience that quietly leaks, so a group- or world-readable file is an
// error rather than a note in a log nobody reads.
const ENV_KEYS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  mistral: "MISTRAL_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  xai: "XAI_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  ollama: "",
  lmstudio: "",
};

export type KeySource = "env" | "file" | "none";

export type KeyResult = { key: string | null; source: KeySource; envVar: string | null };

export const configPath = () => join(homeDir(), "config.json");
export const envVarFor = (providerId: string) =>
  ENV_KEYS[providerId] ?? `${providerId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;

type ConfigFile = { keys?: Record<string, string> };

async function readConfig(): Promise<ConfigFile> {
  const file = Bun.file(configPath());
  if (!(await file.exists())) return {};
  const stat = await file.stat();
  // 0o077: nobody outside this user may read it, because it holds secrets.
  if (stat.mode & 0o077) {
    throw new Error(
      `${configPath()} is readable by other users (mode ${(stat.mode & 0o777).toString(8)}). Run: chmod 600 ${configPath()}`,
    );
  }
  try {
    return JSON.parse(await file.text()) as ConfigFile;
  } catch {
    throw new Error(`${configPath()} is not valid JSON`);
  }
}

/** Local providers need no key at all; that is why they are the zero-config path. */
export function isLocalProvider(id: string) {
  return id === "ollama" || id === "lmstudio";
}

export async function apiKeyFor(providerId: string): Promise<KeyResult> {
  if (isLocalProvider(providerId)) return { key: null, source: "none", envVar: null };
  const envVar = envVarFor(providerId);
  const fromEnv = process.env[envVar];
  if (fromEnv) return { key: fromEnv, source: "env", envVar };
  try {
    const cfg = await readConfig();
    const fromFile = cfg.keys?.[providerId];
    if (fromFile) return { key: fromFile, source: "file", envVar };
  } catch {
    // A permissions or JSON problem must not mask a perfectly good env var, and
    // the caller reports config problems separately via `configProblems`.
  }
  return { key: null, source: "none", envVar };
}

export async function configProblems(): Promise<string[]> {
  const out: string[] = [];
  const file = Bun.file(configPath());
  if (!(await file.exists())) return out;
  try {
    const stat = await file.stat();
    if (stat.mode & 0o077)
      out.push(`${configPath()} is readable by other users — run: chmod 600 ${configPath()}`);
    await readConfig();
  } catch (err) {
    out.push(err instanceof Error ? err.message : String(err));
  }
  return out;
}

/** Never log a key. This is the only form that is safe to print. */
export const redact = (key: string | null) =>
  !key ? "(none)" : key.length <= 8 ? "****" : `${key.slice(0, 3)}…${key.slice(-2)}`;

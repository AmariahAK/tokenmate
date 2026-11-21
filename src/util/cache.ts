import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Everything tokenmate persists lives under one overridable root so tests never
// touch a real home directory and users can relocate state with one variable.
export const homeDir = () => process.env["TOKENMATE_HOME"] ?? join(homedir(), ".tokenmate");
export const cacheDir = () => join(homeDir(), "cache");

export type Cached = { body: string; etag?: string; fetchedAt: number };

export async function readCache(name: string): Promise<Cached | null> {
  const file = Bun.file(join(cacheDir(), name));
  if (!(await file.exists())) return null;
  try {
    const raw = JSON.parse(await file.text()) as Cached;
    if (typeof raw.body !== "string" || typeof raw.fetchedAt !== "number") return null;
    return raw;
  } catch {
    // A half-written or hand-edited cache is not worth reporting; refetching is
    // always correct and the caller treats null as "nothing cached".
    return null;
  }
}

export async function writeCache(name: string, value: Cached): Promise<void> {
  try {
    await Bun.write(join(cacheDir(), name), JSON.stringify(value));
  } catch {
    // An unwritable cache degrades to a slow path, never to a broken command.
  }
}

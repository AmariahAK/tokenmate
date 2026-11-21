import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { tokenmateHome } from "./resume";

// Remembers the last setup choices so a returning player doesn't start at level 8
// every time. The file is tiny JSON next to the save file; a corrupt or missing
// file silently falls back to defaults — preferences are never worth an error.

export type Prefs = { level: number; color: "white" | "black" | "random"; theme: string };

const DEFAULTS: Prefs = { level: 8, color: "white", theme: "slate" };

function prefsPath(): string {
  return join(tokenmateHome(), "prefs.json");
}

export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(readFileSync(prefsPath(), "utf8"));
    return {
      level: typeof raw.level === "number" && raw.level >= 1 && raw.level <= 20 ? Math.trunc(raw.level) : DEFAULTS.level,
      color: ["white", "black", "random"].includes(raw.color) ? raw.color : DEFAULTS.color,
      theme: typeof raw.theme === "string" && raw.theme.length > 0 ? raw.theme : DEFAULTS.theme,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(p: Partial<Prefs>): void {
  try {
    const current = loadPrefs();
    const merged = { ...current, ...p };
    const path = prefsPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(merged, null, 2) + "\n");
  } catch {
    // Preferences are never worth crashing over.
  }
}

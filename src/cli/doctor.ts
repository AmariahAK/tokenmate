import { LEVELS } from "../engine/ladder";
import { strengthNote } from "../engine/any-uci";
import { redact } from "../models/config";
import type { Probe } from "../engine/uci";
import type { ColorMode } from "../ui/ansi";

/**
 * `doctor` answers "why did that not work" before the user has to ask. Every line
 * is a fact we gathered, and anything we could not gather is reported as missing
 * rather than omitted — a blank line would read as "fine".
 */
export type EngineFacts = {
  /** Where it came from: `--engine`, the environment, or PATH. */
  source: string | null;
  cmd: string[];
  id: string | null;
  probe: Probe | null;
  error: string | null;
};

export type DoctorFacts = {
  version: string;
  bun: string;
  platform: string;
  terminal: { cols: number; rows: number; colorMode: ColorMode };
  engine: EngineFacts;
  catalog: { providers: number; models: number; stale: boolean; fetchedAt: number | null; error: string | null };
  local: { providers: { id: string; models: number }[]; missing: { id: string; error?: string }[] };
  config: { path: string; problems: string[]; keys: { provider: string; key: string | null }[] };
  cache: { dir: string; entries: number; bytes: number };
  save: { path: string; exists: boolean };
};

const pad = (label: string) => label.padEnd(14);

const kb = (bytes: number) => `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;

const when = (ms: number | null) => (ms === null ? "never" : new Date(ms).toISOString().replace("T", " ").slice(0, 16));

export function doctorReport(f: DoctorFacts): string[] {
  const lines: string[] = [];

  lines.push(`tokenmate ${f.version}`);
  lines.push(`${pad("bun")}${f.bun} on ${f.platform}`);
  lines.push(`${pad("terminal")}${f.terminal.cols}×${f.terminal.rows}, ${f.terminal.colorMode} colour`);
  lines.push("");

  lines.push("engine");
  if (f.engine.error) {
    // The error is often several lines (a message plus an install hint), so it is
    // indented line by line rather than dropped in after a dash.
    const [first, ...rest] = f.engine.error.split("\n");
    lines.push(`  missing — ${first ?? ""}`);
    for (const line of rest) lines.push(`  ${line}`);
    lines.push("  playing and analysis need one; board, replay and import do not.");
  } else {
    lines.push(`  ${f.engine.id ?? "an engine that did not name itself"}`);
    lines.push(`${pad("  from")}${f.engine.source ?? "unknown"}`);
    lines.push(`${pad("  command")}${f.engine.cmd.join(" ")}`);
    if (f.engine.probe) {
      lines.push(`${pad("  strength")}${strengthNote(f.engine.probe)}`);
      // The ladder's top levels are only honest if the engine can reach them, and a
      // distro build often cannot. Say so here rather than let a level lie.
      const top = LEVELS[LEVELS.length - 1]!.elo;
      const reach = f.engine.probe.uciElo?.max ?? null;
      if (reach !== null && reach < top)
        lines.push(`  note — this build caps at ${reach} Elo, so levels above ${LEVELS.filter((l) => l.elo <= reach).length} cannot reach their stated strength`);
    } else {
      lines.push("  no capability probe — levels fall back to depth handicapping");
    }
  }
  lines.push("");

  lines.push("models");
  lines.push(`${pad("  catalogue")}${f.catalog.providers} providers, ${f.catalog.models} models, fetched ${when(f.catalog.fetchedAt)}${f.catalog.stale ? " (stale)" : ""}`);
  if (f.catalog.error) lines.push(`  catalogue problem — ${f.catalog.error}`);
  if (!f.local.providers.length) lines.push("  local — none running (ollama and LM Studio are optional)");
  else for (const p of f.local.providers) lines.push(`  local — ${p.id}: ${p.models} model${p.models === 1 ? "" : "s"}`);
  for (const m of f.local.missing) lines.push(`  not running — ${m.id}${m.error ? ` (${m.error})` : ""}`);
  if (f.config.keys.length)
    for (const k of f.config.keys) lines.push(`  key — ${k.provider}: ${redact(k.key)}`);
  for (const problem of f.config.problems) lines.push(`  config — ${problem}`);
  lines.push("");

  lines.push("cache and saves");
  lines.push(`${pad("  cache")}${f.cache.dir} (${f.cache.entries} file${f.cache.entries === 1 ? "" : "s"}, ${kb(f.cache.bytes)})`);
  lines.push(`${pad("  save")}${f.save.path}${f.save.exists ? "" : " (no saved game)"}`);

  return lines;
}

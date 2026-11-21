#!/usr/bin/env bun
// Licence gate. tokenmate is MIT and must stay MIT, so a copyleft dependency has
// to fail the build rather than be discovered at release time.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const DENY = /\b(?:(?:A|L)?GPL-\d|SSPL-\d|OSL-\d|EUPL-\d|CPAL-\d|CC-BY-SA-\d)\b/i;

// Known copyleft, examined and accepted. Anything not listed here fails.
const ALLOW: { name: RegExp; why: string }[] = [
  {
    name: /^@opentui\/core-/,
    why: "libopentui statically links a decode-only FFmpeg 9.0.2 built with --disable-gpl --disable-nonfree (LGPL-2.1). Upstream ships the exact source and relink instructions, we install this from npm instead of redistributing it, and `bun build --target bun` never bakes the dylib into our artefact. Use --strict before any single-file release.",
  },
];

const strict = process.argv.includes("--strict");
const roots = ["node_modules"];
const found: { name: string; version: string; license: string }[] = [];

async function readPkg(dir: string) {
  try {
    return JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

for (const root of roots) {
  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    console.log(`no ${root} — run bun install first`);
    process.exit(0);
  }
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const dirs = entry.startsWith("@")
      ? (await readdir(join(root, entry))).map((d) => join(root, entry, d))
      : [join(root, entry)];
    for (const dir of dirs) {
      const pkg = await readPkg(dir);
      if (!pkg?.name) continue;
      const license =
        typeof pkg.license === "string"
          ? pkg.license
          : (pkg.license?.type ?? (Array.isArray(pkg.licenses) ? pkg.licenses.map((l: { type?: string }) => l.type).join(" OR ") : "UNKNOWN"));
      found.push({ name: pkg.name, version: pkg.version ?? "?", license });
    }
  }
}

const copyleft = found.filter((p) => DENY.test(p.license));
const allowed = strict ? [] : ALLOW.filter((a) => copyleft.some((p) => a.name.test(p.name)));
const bad = copyleft.filter((p) => !allowed.some((a) => a.name.test(p.name)));

console.log(`checked ${found.length} installed packages${strict ? " (strict: allowlist ignored)" : ""}`);
const counts = new Map<string, number>();
for (const p of found) counts.set(p.license, (counts.get(p.license) ?? 0) + 1);
for (const [license, n] of [...counts].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${license}`);
}

if (bad.length) {
  console.error(`\nFAIL — ${bad.length} copyleft dependency/dependencies:`);
  for (const p of bad) console.error(`  ${p.name}@${p.version}  ${p.license}`);
  console.error("\ntokenmate ships MIT. Use a permissive alternative, or make it an optional runtime integration.");
  process.exit(1);
}

for (const a of allowed) {
  console.log(`\nallowed: ${a.why}`);
}

console.log("\nPASS — no GPL/AGPL dependency in the tree");

#!/usr/bin/env bun
// Renders the board the README shows, from the shipping renderer, so the picture
// cannot drift from what the app draws.
//   bun run board                    → text (for a terminal or a code block)
//   bun run board --svg docs/board.svg → vector image (for the README)
import { drawBoard } from "../src/ui/board";
import { Grid } from "../src/ui/grid";
import { themes } from "../src/ui/theme";

const args = process.argv.slice(2);
const svgAt = args.indexOf("--svg");
const themeKey = args.find((a, i) => i > 0 && args[i - 1] === "--theme") ?? "slate";
const fen = args.find((a, i) => i > 0 && args[i - 1] === "--fen") ?? "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";

const theme = themes.find((t) => t.key === themeKey);
if (!theme) {
  console.error(`unknown theme ${themeKey}; pick one of ${themes.map((t) => t.key).join(", ")}`);
  process.exit(1);
}

const COLS = 34;
const ROWS = 25;
const g = new Grid(COLS, ROWS);
drawBoard(g, 0, 0, fen, theme, { tier: "boxed" });

if (svgAt < 0) {
  console.log(g.toText());
  process.exit(0);
}

// One cell is one character cell: 8×16 keeps the 1:2 cell ratio a terminal has.
const CW = 8;
const CH = 16;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

const parts: string[] = [];
for (let y = 0; y < ROWS; y++) {
  let runStart = 0;
  let runBg: string | undefined;
  const flush = (end: number) => {
    if (runBg)
      parts.push(
        `<rect x="${runStart * CW}" y="${y * CH}" width="${(end - runStart) * CW}" height="${CH}" fill="${runBg}"/>`,
      );
  };
  for (let x = 0; x < COLS; x++) {
    const bg = g.styleAt(x, y)?.bg;
    if (x === 0) runBg = bg;
    else if (bg !== runBg) {
      flush(x);
      runStart = x;
      runBg = bg;
    }
  }
  flush(COLS);
  for (let x = 0; x < COLS; x++) {
    const c = g.cellAt(x, y);
    if (!c || c.ch === " ") continue;
    const cx = (x + c.w / 2) * CW;
    const cy = y * CH + CH / 2;
    const weight = c.bold ? ' font-weight="700"' : "";
    const fg = c.fg ?? "#c9d1d9";
    parts.push(
      `<text x="${cx}" y="${cy}" fill="${fg}"${weight} font-size="14" text-anchor="middle" dominant-baseline="central">${esc(c.ch)}</text>`,
    );
  }
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${COLS * CW}" height="${ROWS * CH}" viewBox="0 0 ${COLS * CW} ${ROWS * CH}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">\n${parts.join("\n")}\n</svg>\n`;
const out = args[svgAt + 1];
if (!out) {
  console.error("usage: bun run board --svg <path>");
  process.exit(1);
}
await Bun.write(out, svg);
console.log(`wrote ${out} (${parts.length} elements)`);

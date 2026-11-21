import { Grid, displayWidth } from "./grid";

/** How the terminal will be asked to paint a frame. */
export type ColorMode = "truecolor" | "256" | "none";

const hex = (c: string): [number, number, number] => {
  const v = c.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
};

// The 6×6×6 cube is not uniform: index 16 and 231 are black and white, and the
// steps are 0/95/135/175/215/255. Nearest-match in that grid is what most
// terminals do, so doing it ourselves keeps a 256-colour frame close to the
// truecolor one instead of trusting the emulator to guess.
const to256 = (c: string) => {
  const [r, g, b] = hex(c);
  const step = (v: number) => (v < 48 ? 0 : v < 115 ? 1 : Math.round((v - 35) / 40));
  return 16 + 36 * step(r) + 6 * step(g) + step(b);
};

export function toAnsi(g: Grid, mode: ColorMode = "truecolor"): string {
  if (mode === "none") return g.toText();
  const lines: string[] = [];
  for (let y = 0; y < g.h; y++) {
    let out = "";
    let lastFg = "";
    let lastBg = "";
    let lastBold: boolean | undefined;
    for (let x = 0; x < g.w; x++) {
      const st = g.styleAt(x, y);
      const fg = st?.fg ?? "";
      const bg = st?.bg ?? "";
      const bold = st?.bold ?? false;
      if (fg !== lastFg || bg !== lastBg || bold !== lastBold) {
        const parts: string[] = [];
        if (fg !== lastFg) parts.push(fg ? `38;${mode === "256" ? `5;${to256(fg)}` : `2;${hex(fg).join(";")}`}` : "39");
        if (bg !== lastBg) parts.push(bg ? `48;${mode === "256" ? `5;${to256(bg)}` : `2;${hex(bg).join(";")}`}` : "49");
        if (bold !== lastBold) parts.push(bold ? "1" : "22");
        out += `\x1b[${parts.join(";")}m`;
        lastFg = fg;
        lastBg = bg;
        lastBold = bold;
      }
      // A continuation cell is painted by its glyph's own span, so emitting a
      // space here would double the width of the frame.
      const cell = g.cellAt(x, y);
      if (cell) out += cell.ch;
    }
    lines.push(out + "\x1b[0m");
  }
  return lines.join("\n");
}

/** Truncate to a cell budget without splitting a wide glyph in half. */
export const clip = (s: string, width: number) => {
  let out = "";
  let w = 0;
  for (const ch of s) {
    const cw = displayWidth(ch);
    if (w + cw > width) break;
    out += ch;
    w += cw;
  }
  return out;
};

export type Style = { fg?: string; bg?: string; bold?: boolean; dim?: boolean };

type Cell = { ch: string; w: 1 | 2; style: Style } | { cont: true; style: Style };

// Chess glyphs and CJK are East-Asian-ambiguous: a terminal may paint one two
// cells wide, so the framebuffer reserves two and marks the second as a
// continuation that has no cell of its own.
const WIDE = /[\u2654-\u265F\u4E00-\u9FFF]/;
export const charWidth = (ch: string): 1 | 2 => (WIDE.test(ch) ? 2 : 1);
export const displayWidth = (s: string) => [...s].reduce((a, c) => a + charWidth(c), 0);

// A cell framebuffer, the same model OpenTUI renders: every cell carries its own
// style, so a frame can be handed to the terminal in one pass. Borders register
// themselves so `text` clips instead of painting over a panel edge.
export class Grid {
  private rows: Cell[][];
  private borders = new Set<string>();

  constructor(
    public readonly w: number,
    public readonly h: number,
    private base: Style = {},
  ) {
    this.rows = Array.from({ length: h }, () =>
      Array.from({ length: w }, () => ({ ch: " ", w: 1 as const, style: { ...base } })),
    );
  }

  put(x: number, y: number, str: string, style: Style = {}) {
    const row = this.rows[y];
    let cx = x;
    for (const ch of str) {
      const w = charWidth(ch);
      if (row && cx >= 0 && cx < this.w) {
        row[cx] = { ch, w, style: { ...this.base, ...style } };
        // The glyph's span paints both columns, so its background covers the
        // continuation cell too — an image of the grid needs that colour back.
        if (w === 2 && cx + 1 < this.w) row[cx + 1] = { cont: true, style: { ...this.base, ...style } };
      }
      cx += w;
    }
    return this;
  }

  cellAt(x: number, y: number) {
    const c = this.rows[y]?.[x];
    if (!c || "cont" in c) return null;
    return { ch: c.ch, w: c.w, fg: c.style.fg, bg: c.style.bg, bold: c.style.bold };
  }

  // A continuation cell has no glyph of its own, but it does have the style of
  // the glyph that spans it, which is what an image of the grid needs.
  styleAt(x: number, y: number) {
    return this.rows[y]?.[x]?.style;
  }

  limit(x: number, y: number) {
    for (let i = x; i < this.w; i++) if (this.borders.has(`${i},${y}`)) return i - x;
    return this.w - x;
  }

  text(x: number, y: number, str: string, style: Style = {}, maxW = this.limit(x, y)) {
    let w = 0;
    let out = "";
    for (const ch of str) {
      const cw = charWidth(ch);
      if (w + cw > maxW) break;
      out += ch;
      w += cw;
    }
    this.put(x, y, out, style);
    return this;
  }

  fill(x: number, y: number, w: number, h: number, style: Style) {
    for (let j = y; j < y + h; j++) {
      const row = this.rows[j];
      if (!row) continue;
      for (let i = x; i < x + w; i++) {
        const c = row[i];
        if (c) c.style = { ...c.style, ...style };
      }
    }
    return this;
  }

  box(x: number, y: number, w: number, h: number, title = "", style: Style = {}) {
    const s: Style = { ...style, dim: false };
    for (let i = x; i < x + w; i++) {
      this.borders.add(`${i},${y}`);
      this.borders.add(`${i},${y + h - 1}`);
    }
    for (let j = y; j < y + h; j++) {
      this.borders.add(`${x},${j}`);
      this.borders.add(`${x + w - 1},${j}`);
    }
    this.put(x, y, "┌" + "─".repeat(w - 2) + "┐", s);
    for (let j = 1; j < h - 1; j++) {
      this.put(x, y + j, "│", s);
      this.put(x + w - 1, y + j, "│", s);
    }
    this.put(x, y + h - 1, "└" + "─".repeat(w - 2) + "┘", s);
    if (title) {
      this.put(x + 2, y, ` ${title} `, { ...s, bold: true });
      for (let i = x + 2; i < x + 2 + displayWidth(` ${title} `); i++) this.borders.delete(`${i},${y}`);
    }
    return this;
  }

  // A border cell that has been painted over is a layout bug that a screenshot
  // does not show, so every screen asserts this before it is shown. A test can
  // only catch it if the framebuffer remembers where the borders were.
  assertBorders(label: string) {
    const bad: string[] = [];
    for (const key of this.borders) {
      const [x, y] = key.split(",").map(Number) as [number, number];
      const c = this.rows[y]?.[x];
      if (!c || "cont" in c || !/[\-\u2500-\u257F]/.test(c.ch)) bad.push(`(${x},${y})='${c && !("cont" in c) ? c.ch : ""}'`);
    }
    if (bad.length) throw new Error(`${label}: ${bad.length} border cell(s) overwritten: ${bad.slice(0, 6).join(" ")}`);
    return true;
  }

  toText() {
    return this.rows.map((row) => row.map((c) => ("cont" in c ? "" : c.ch)).join("")).join("\n");
  }
}

import { describe, expect, test } from "bun:test";
import { drawBoxes, GLYPHS, padding, parseFen, sqName, stateOf, getPieceStyle } from "../src/ui/board";
import { Grid } from "../src/ui/grid";
import { layoutFor } from "../src/ui/layout";
import { square, themes, type Theme } from "../src/ui/theme";

const FEN = "r1bqk2r/1pppbppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQ1RK1";
const MARKS = { lastMove: ["f8", "e7"] as [string, string], selected: "b5", check: "g8" };
const GLYPH_W = () => getPieceStyle() === "unicode" ? 2 : 1;
const PIECE_RE = () => getPieceStyle() === "unicode" ? /[\u2654-\u265F]/ : /^[KQRBNPkqrbnp]$/;
const SIZES: [number, number][] = [
  [2, 1],
  [4, 3],
  [6, 3],
  [8, 3],
  [10, 5],
];

type Box = { x: number; y: number; w: number; h: number };
type Mutation = (g: Grid, box: Box) => void;

// Every glyph is located by scanning the framebuffer, never by trusting the
// offset that drew it — that is the whole point of the check.
type Audit = { checks: number; failures: string[]; continuations: number };

function audit(t: Theme, cw: number, ch: number, shift = 0, mutate?: Mutation): Audit {
  const g = new Grid(cw * 8 + 2 + shift, ch * 8 + 1, { fg: "#c9d1d9" });
  const box = drawBoxes(g, shift, 0, FEN, t, { ...MARKS, cw, ch });
  mutate?.(g, box);
  const board = parseFen(FEN);
  const out: Audit = { checks: 0, failures: [], continuations: 0 };
  const at = `${t.key} ${cw}x${ch}`;
  const ok = (cond: boolean, msg: string) => {
    out.checks++;
    if (!cond) out.failures.push(msg);
    return cond;
  };

  ok(box.w === cw * 8 && box.h === ch * 8, `${at}: board size ${box.w}x${box.h}`);
  // Where the audit *expects* the board to be: the glyph gutter plus the shift the
  // board was actually drawn at. A mutation that moves the board leaves them unequal.
  const ox0 = box.x - shift;
  const oy0 = box.y;

  for (let r = 0; r < 8; r++)
    for (let f = 0; f < 8; f++) {
      const ox = ox0 + f * cw;
      const oy = oy0 + r * ch;
      const p = board[r]?.[f] ?? null;
      const bg = square(t, (f + r) % 2 === 0, stateOf(MARKS, sqName(f, r)));

      for (let y = 0; y < ch; y++)
        for (let x = 0; x < cw; x++) {
          const c = g.cellAt(ox + x, oy + y);
          // A wide glyph marks its second column as a continuation with no cell of
          // its own; the glyph's span paints both columns, so there is nothing to check.
          if (!c) {
            out.continuations++;
            continue;
          }
          ok(c.bg?.toLowerCase() === bg.toLowerCase(), `${at} ${sqName(f, r)} (${x},${y}) bg ${c.bg} != ${bg}`);
        }

      const found: { x: number; y: number; ch: string; fg?: string }[] = [];
      for (let y = 0; y < ch; y++)
        for (let x = 0; x < cw; x++) {
          const c = g.cellAt(ox + x, oy + y);
          if (c && PIECE_RE().test(c.ch)) found.push({ x: ox + x, y: oy + y, ch: c.ch, fg: c.fg });
        }
      if (!p) {
        ok(found.length === 0, `${at} ${sqName(f, r)}: empty square drew ${found.length} glyph(s)`);
        continue;
      }
      if (!ok(found.length === 1, `${at} ${sqName(f, r)}: ${found.length} glyph cells`)) continue;

      const gl = found[0]!;
      ok(gl.ch === GLYPHS[p.c][p.t], `${at} ${sqName(f, r)}: glyph ${gl.ch} != ${GLYPHS[p.c][p.t]}`);
      ok(gl.fg === (p.c === "w" ? t.whitePiece : t.blackPiece), `${at} ${sqName(f, r)}: fg ${gl.fg}`);
      const gw = GLYPH_W();
      const leftPad = gl.x - ox;
      const rightPad = ox + cw - gw - gl.x;
      // A 1-cell glyph in an even-width box can't be perfectly centred; ±1 is the best.
      const maxDrift = gw === 1 && cw % 2 === 0 ? 1 : 0;
      ok(
        Math.abs(leftPad - rightPad) <= maxDrift,
        `${at} ${sqName(f, r)}: horizontal padding uneven (${leftPad} vs ${rightPad})`,
      );
      ok(gl.y - oy === oy + ch - 1 - gl.y, `${at} ${sqName(f, r)}: vertical padding uneven (${gl.y - oy} vs ${oy + ch - 1 - gl.y})`);
    }

  const { px, py } = padding(cw, ch);
  for (let f = 0; f < 8; f++)
    ok(
      g.cellAt(box.x + f * cw + px, box.h)?.ch === "abcdefgh"[f],
      `${at}: file label ${f} = ${g.cellAt(box.x + f * cw + px, box.h)?.ch}`,
    );
  for (let r = 0; r < 8; r++)
    ok(g.cellAt(shift, r * ch + py)?.ch === String(8 - r), `${at}: rank label row ${r} = ${g.cellAt(shift, r * ch + py)?.ch}`);

  return out;
}

describe("board layout", () => {
  test("every glyph on every tier of every theme is dead centre", () => {
    let checks = 0;
    let continuations = 0;
    const failures: string[] = [];
    for (const t of themes)
      for (const [cw, ch] of SIZES) {
        const a = audit(t, cw, ch);
        checks += a.checks;
        continuations += a.continuations;
        failures.push(...a.failures);
      }
    expect(failures.slice(0, 8)).toEqual([]);
    // The baseline this port must preserve: 5 themes × 5 tiers × (every square's
    // cells, a check per empty square, five per piece, both label rows). Together
    // with the 4 padding assertions below it is the 38,349 of the design prototype.
    // Letter pieces are 1-cell, so no continuations; unicode would have them.
    expect(checks).toBe(39_145);
  });

  test("the audit fails when a board is drawn one cell out", () => {
    // Proves the check above can fail. Drawing at column 1 while the audit looks at
    // column 0 shifts every square by one: one column of each of its ch rows lands
    // on the neighbouring square, so 64 × 3 cells report the wrong background.
    // Proves the check above can fail. Drawing at column 1 while the audit looks at
    // column 0 shifts every square by one: one column of each of its ch rows lands
    // on the neighbouring square (64 × 3 = 192 cells), and all 32 pieces sit off centre.
    // With 1-cell letter pieces, a 1-cell shift still puts every piece off-centre
    // but within the ±1 tolerance, so only bg mismatches are caught.
    const shifted = audit(themes[0]!, 4, 3, 1);
    expect(shifted.failures.filter((f) => f.includes("bg ")).length).toBe(192);
    expect(shifted.failures.length).toBeGreaterThanOrEqual(192);
  });

  test("the audit fails when one glyph is nudged two cells", () => {
    // The smaller, likelier mistake: padding maths drifts for one square only.
    // a4 is the first square in the fixture FEN that holds a piece.
    // Nudge by 2 cells, which exceeds the ±1 tolerance for letter pieces.
    const { px, py } = padding(4, 3);
    const a = audit(themes[0]!, 4, 3, 0, (g, box) => {
      const x = box.x + 0 * 4 + px;
      const y = 4 * 3 + py;
      const gl = g.cellAt(x, y)!;
      g.put(x, y, " ", { bg: gl.bg });
      g.put(x + 2, y, gl.ch, { bg: gl.bg, fg: gl.fg, bold: true });
    });
    expect(a.failures.length).toBe(1);
    expect(a.failures[0]).toContain("a4");
    expect(a.failures[0]).toContain("horizontal padding uneven");
  });

  test("off-centre geometries produce correct padding", () => {
    // With letter pieces (1-cell), padding is always floor-based, no throw.
    expect(padding(4, 3)).toEqual({ px: 1, py: 1 });
    expect(padding(6, 3)).toEqual({ px: 2, py: 1 });
    expect(padding(2, 1)).toEqual({ px: 0, py: 0 });
    expect(padding(7, 3)).toEqual({ px: 3, py: 1 });
    expect(padding(6, 2)).toEqual({ px: 2, py: 0 });
  });

  test("a boxed square tiles without gaps", () => {
    const g = new Grid(34, 25);
    const box = drawBoxes(g, 0, 0, FEN, themes[0]!);
    expect({ w: box.w, h: box.h }).toEqual({ w: 32, h: 24 });
    expect(g.toText().split("\n").length).toBe(25);
  });
});

describe("layout tiers", () => {
  test("bigger squares win when they fit, 4×3 ships at 96×37", () => {
    expect(layoutFor(96, 37)).toEqual({ tier: "boxed", panels: true });
    expect(layoutFor(80, 30)).toEqual({ tier: "boxed", panels: false });
    expect(layoutFor(110, 30)).toEqual({ tier: "wide", panels: true });
  });

  test("a narrow terminal degrades instead of refusing to run", () => {
    // 4×3 needs 34×25 and is always the fallback before 2×1, which needs 18×9.
    expect(layoutFor(60, 30)).toEqual({ tier: "boxed", panels: false });
    expect(layoutFor(20, 10)).toEqual({ tier: "compact", panels: false });
    expect(() => layoutFor(17, 10)).toThrow(/at least 18×9/);
    expect(() => layoutFor(80, 8)).toThrow(/at least/);
  });

  test("panels only appear when there is room for the board and the panels", () => {
    for (const [cols, rows] of [
      [96, 37],
      [80, 30],
      [110, 30],
      [20, 10],
    ] as const) {
      const l = layoutFor(cols, rows);
      if (!l.panels) continue;
      expect(cols).toBeGreaterThanOrEqual((l.tier === "wide" ? 50 : 34) + 2 + 58);
      expect(rows).toBeGreaterThanOrEqual(25);
    }
  });
});

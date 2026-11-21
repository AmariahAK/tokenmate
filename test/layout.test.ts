import { describe, expect, test } from "bun:test";
import { drawBoxes, GLYPHS, padding, parseFen, sqName, stateOf, getPieceStyle } from "../src/ui/board";
import { Grid } from "../src/ui/grid";
import { layoutFor } from "../src/ui/layout";
import { square, themes, type Theme } from "../src/ui/theme";

const FEN = "r1bqk2r/1pppbppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQ1RK1";
const MARKS = { lastMove: ["f8", "e7"] as [string, string], selected: "b5", check: "g8" };
const GLYPH_W = () => getPieceStyle() === "unicode" ? 2 : 1;
const PIECE_RE = () => getPieceStyle() === "unicode" ? /[\u2654-\u265F]/ : /^[KQRBNPkqrbnp]$/;
// Block elements used by sprites — any non-space cell with the piece's fg colour is part of the sprite
const BLOCK_RE = /^[█▀▄▐▌▗▖▝▘]$/;
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
  const isSprite = getPieceStyle() === "sprite" && cw >= 4 && ch >= 3;
  const ok = (cond: boolean, msg: string) => {
    out.checks++;
    if (!cond) out.failures.push(msg);
    return cond;
  };

  ok(box.w === cw * 8 && box.h === ch * 8, `${at}: board size ${box.w}x${box.h}`);
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
          if (!c) {
            out.continuations++;
            continue;
          }
          ok(c.bg?.toLowerCase() === bg.toLowerCase(), `${at} ${sqName(f, r)} (${x},${y}) bg ${c.bg} != ${bg}`);
        }

      if (isSprite) {
        // In sprite mode, a piece is identified by non-space cells with the piece's fg colour
        const expectedFg = p ? (p.c === "w" ? t.whitePiece : t.blackPiece) : null;
        const blockCells: { x: number; y: number }[] = [];
        for (let y = 0; y < ch; y++)
          for (let x = 0; x < cw; x++) {
            const c = g.cellAt(ox + x, oy + y);
            if (c && BLOCK_RE.test(c.ch)) blockCells.push({ x: ox + x, y: oy + y });
          }
        if (!p) {
          ok(blockCells.length === 0, `${at} ${sqName(f, r)}: empty square drew ${blockCells.length} block cells`);
        } else {
          // A sprite should have painted some block cells
          ok(blockCells.length > 0, `${at} ${sqName(f, r)}: piece has 0 block cells`);
          // All block cells should have the piece's fg colour
          for (const bc of blockCells) {
            const c = g.cellAt(bc.x, bc.y)!;
            ok(c.fg === expectedFg, `${at} ${sqName(f, r)}: block cell fg ${c.fg} != ${expectedFg}`);
          }
          // Check the sprite is roughly centred: the bounding box of block cells
          // should be centred within the square (±1 tolerance)
          if (blockCells.length > 0) {
            const minX = Math.min(...blockCells.map(c => c.x));
            const maxX = Math.max(...blockCells.map(c => c.x));
            const leftPad = minX - ox;
            const rightPad = ox + cw - 1 - maxX;
            ok(Math.abs(leftPad - rightPad) <= 1, `${at} ${sqName(f, r)}: sprite h-centre off (${leftPad} vs ${rightPad})`);
            const minY = Math.min(...blockCells.map(c => c.y));
            const maxY = Math.max(...blockCells.map(c => c.y));
            const topPad = minY - oy;
            const botPad = oy + ch - 1 - maxY;
            ok(Math.abs(topPad - botPad) <= 1, `${at} ${sqName(f, r)}: sprite v-centre off (${topPad} vs ${botPad})`);
          }
        }
      } else {
        // Letter / unicode mode: single glyph centring check
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
        const maxDrift = gw === 1 && cw % 2 === 0 ? 1 : 0;
        ok(
          Math.abs(leftPad - rightPad) <= maxDrift,
          `${at} ${sqName(f, r)}: horizontal padding uneven (${leftPad} vs ${rightPad})`,
        );
        ok(gl.y - oy === oy + ch - 1 - gl.y, `${at} ${sqName(f, r)}: vertical padding uneven (${gl.y - oy} vs ${oy + ch - 1 - gl.y})`);
      }
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
    // Sprite mode at 4×3+ tiers checks block cells, fg colour and bounding-box centring;
    // letter mode at 2×1 checks single-glyph centring. The total varies with piece style.
    expect(checks).toBeGreaterThan(30_000);
  });

  test("the audit fails when a board is drawn one cell out", () => {
    // Drawing at column 1 while the audit looks at column 0 shifts every square
    // by one: cells land on the neighbouring square's bg.
    const shifted = audit(themes[0]!, 4, 3, 1);
    expect(shifted.failures.filter((f) => f.includes("bg ")).length).toBe(192);
    expect(shifted.failures.length).toBeGreaterThanOrEqual(192);
  });

  test("the audit fails when a sprite is erased", () => {
    // Erase all block cells in the a8 square — the audit should catch "0 block cells"
    const a = audit(themes[0]!, 4, 3, 0, (g, box) => {
      // a8 is file 0, rank 0
      const ox = box.x;
      const oy = box.y;
      for (let y = 0; y < 3; y++)
        for (let x = 0; x < 4; x++)
          g.put(ox + x, oy + y, " ", { bg: "#000000" });
    });
    expect(a.failures.length).toBeGreaterThanOrEqual(1);
    expect(a.failures.some(f => f.includes("a8"))).toBe(true);
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

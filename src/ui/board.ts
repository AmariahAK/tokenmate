import { Grid } from "./grid";
import { square, type State, type Theme } from "./theme";

// Side is encoded by glyph fill as well as colour, so a monochrome or
// colour-blind-broken theme still separates the two sides.
export const GLYPHS: Record<"w" | "b", Record<string, string>> = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};

export type Marks = { lastMove?: [string, string]; selected?: string; check?: string };

export type BoardOpts = Marks & {
  hints?: string[];
  coord?: string;
  files?: boolean;
  ranks?: boolean;
  coords?: boolean;
  cw?: number;
  ch?: number;
};

export type Piece = { t: string; c: "w" | "b" };

export function parseFen(fen: string): (Piece | null)[][] {
  const field = fen.split(" ")[0];
  if (!field) throw new Error(`empty FEN: ${fen}`);
  return field.split("/").map((rank) => {
    const out: (Piece | null)[] = [];
    for (const ch of rank) {
      if (/\d/.test(ch)) for (let i = 0; i < +ch; i++) out.push(null);
      else out.push({ t: ch.toLowerCase(), c: ch === ch.toUpperCase() ? "w" : "b" });
    }
    return out;
  });
}

const FILES = "abcdefgh";

export const sqName = (f: number, r: number) => `${FILES[f] ?? "?"}${8 - r}`;

export const stateOf = (o: Marks, name: string): State =>
  o.check === name ? "check" : o.selected === name ? "selected" : o.lastMove?.includes(name) ? "last" : "none";

// The tier is chosen from the terminal so a small window shrinks the board
// instead of refusing to run. 4×3 ships; see docs/ARCHITECTURE.md for why.
export const TIERS = {
  boxed: { cw: 4, ch: 3 }, // 32 × 24
  wide: { cw: 6, ch: 3 }, // 48 × 24
  compact: { cw: 2, ch: 1 }, // 16 × 8
} as const;

export type Tier = keyof typeof TIERS;

// Chess glyphs are East-Asian-ambiguous, so a square reserves two cells for one
// and centres it inside those two. Everything else is padding, and because the
// padding is symmetric the glyph lands dead centre whatever the terminal decides.
const GLYPH_W = 2;

// Symmetric padding needs the leftover columns to be even and the leftover rows
// to split in two, so cw must be even and ch odd. Off-centre becomes impossible
// rather than merely unlikely, and an invalid tier throws instead of drawing.
export const padding = (cw: number, ch: number) => {
  if (cw % 2 !== 0 || ch % 2 === 0)
    throw new Error(`square ${cw}×${ch}: need even cw and odd ch to centre a ${GLYPH_W}-cell glyph`);
  return { px: (cw - GLYPH_W) / 2, py: (ch - 1) / 2 };
};

export function drawSquareBox(
  g: Grid,
  x: number,
  y: number,
  cw: number,
  ch: number,
  glyph: string | null,
  bg: string,
  fg = "#FFFFFF",
) {
  g.fill(x, y, cw, ch, { bg });
  if (!glyph) return;
  const { px, py } = padding(cw, ch);
  g.put(x + px, y + py, glyph, { fg, bg, bold: true });
}

// A terminal cannot scale a glyph, so the size lives in the square, not the piece.
export function drawBoxes(g: Grid, x: number, y: number, fen: string, t: Theme, o: BoardOpts = {}) {
  const cw = o.cw ?? TIERS.boxed.cw;
  const ch = o.ch ?? TIERS.boxed.ch;
  const { px, py } = padding(cw, ch);
  const board = parseFen(fen);
  const showCoords = o.coords !== false;
  const bx = x + (showCoords ? 2 : 0);
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r]?.[f] ?? null;
      const bg = square(t, (f + r) % 2 === 0, stateOf(o, sqName(f, r)));
      drawSquareBox(g, bx + f * cw, y + r * ch, cw, ch, p ? (GLYPHS[p.c][p.t] ?? null) : null, bg,
        p?.c === "b" ? t.blackPiece : t.whitePiece);
    }
  }
  if (showCoords) {
    for (let r = 0; r < 8; r++) g.put(x, y + r * ch + py, String(8 - r), { fg: o.coord ?? t.coord });
    for (let f = 0; f < 8; f++) g.put(bx + f * cw + px, y + 8 * ch, FILES[f]!, { fg: o.coord ?? t.coord });
  }
  return { x: bx, y, w: cw * 8, h: ch * 8 };
}

// Compact board: a chess glyph in a fixed 2-column cell. The cell width is what
// makes it immune to terminals disagreeing about how wide these glyphs are.
export function drawCompact(g: Grid, x: number, y: number, fen: string, t: Theme, o: BoardOpts = {}) {
  const board = parseFen(fen);
  const showFiles = o.files !== false;
  const showRanks = o.ranks !== false;
  const bx = x + (showRanks ? 2 : 0);
  for (let r = 0; r < 8; r++) {
    if (showRanks) g.put(x, y + r, String(8 - r), { fg: o.coord ?? t.coord });
    for (let f = 0; f < 8; f++) {
      const name = sqName(f, r);
      const bg = square(t, (f + r) % 2 === 0, stateOf(o, name));
      const p = board[r]?.[f] ?? null;
      if (p)
        g.put(bx + f * 2, y + r, GLYPHS[p.c][p.t]!, {
          fg: p.c === "w" ? t.whitePiece : t.blackPiece,
          bg,
          bold: true,
        });
      else g.put(bx + f * 2, y + r, o.hints?.includes(name) ? "··" : "  ", { bg, fg: t.hint });
    }
  }
  if (showFiles)
    for (let f = 0; f < 8; f++) g.put(bx + f * 2, y + 8, `${FILES[f]!} `, { fg: o.coord ?? t.coord });
  return { x: bx, y, w: 16, h: 8 };
}

export const boardFootprint = (tier: Tier) => {
  const { cw, ch } = TIERS[tier];
  return { w: 2 + cw * 8, h: ch * 8 + 1 };
};

export function drawBoard(g: Grid, x: number, y: number, fen: string, t: Theme, o: BoardOpts & { tier?: Tier } = {}) {
  const tier = o.tier ?? "boxed";
  if (tier === "compact") return drawCompact(g, x, y, fen, t, o);
  return drawBoxes(g, x, y, fen, t, { ...o, cw: TIERS[tier].cw, ch: TIERS[tier].ch });
}

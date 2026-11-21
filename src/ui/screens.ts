import { boardFootprint, drawBoard, parseFen, type Marks } from "./board";
import { Grid, displayWidth } from "./grid";
import { layoutFor, type Layout } from "./layout";
import type { Theme } from "./theme";

export type GameView = {
  cols: number;
  rows: number;
  theme: Theme;
  fen: string;
  marks?: Marks;
  hints?: string[];
  /** SAN move list in play order. */
  moves: string[];
  /** Plies played, used to mark the current move in the list. */
  ply: number;
  /** Centipawns from white's point of view; null before the first eval. */
  evalCp: number | null;
  mateIn: number | null;
  bestLine: string | null;
  /** Model commentary, engine note, or null. */
  thoughts: string | null;
  status: string;
  level: number;
  levelElo: number;
  opponent: string;
  engine: string | null;
  clocks: { white: number; black: number } | null;
  /** A transient line: fallback to the engine, model rejected a move, etc. */
  notice?: string;
};

const START_COUNT: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };

export function capturedPieces(fen: string) {
  const left: Record<string, number> = {};
  for (const rank of parseFen(fen)) for (const p of rank) if (p) left[`${p.c}${p.t}`] = (left[`${p.c}${p.t}`] ?? 0) + 1;
  const captured = { w: [] as string[], b: [] as string[] };
  for (const side of ["w", "b"] as const) {
    for (const [t, n] of Object.entries(START_COUNT)) {
      const missing = n - (left[`${side}${t}`] ?? 0);
      for (let i = 0; i < missing; i++) captured[side].push(t);
    }
  }
  return captured;
}

/** 1/(1+10^-cp/400): the standard logistic, so the bar agrees with chess intuition. */
export const whiteShare = (cp: number) => 1 / (1 + Math.pow(10, -cp / 400));

export function formatMoves(moves: string[], innerW: number): string[] {
  const tokens: string[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    tokens.push(`${i / 2 + 1}.${moves[i]}`, moves[i + 1] ?? "");
  }
  const lines: string[] = [];
  let cur = "";
  for (const tok of tokens.filter(Boolean)) {
    const next = cur ? `${cur} ${tok}` : tok;
    if (displayWidth(next) > innerW) {
      if (cur) lines.push(cur);
      cur = tok;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

export function wrap(text: string, innerW: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let cur = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = cur ? `${cur} ${word}` : word;
      if (displayWidth(next) > innerW) {
        if (cur) lines.push(cur);
        cur = word;
      } else cur = next;
    }
    lines.push(cur);
  }
  return lines;
}

export const clock = (ms: number | null) => {
  if (ms === null) return "--:--";
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

const evalLabel = (cp: number | null, mate: number | null) => {
  if (mate !== null) return `M${Math.abs(mate)}`;
  if (cp === null) return "0.0";
  const p = cp / 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(1)}`;
};

function panel(g: Grid, x: number, y: number, w: number, h: number, title: string, body: string[], t: Theme) {
  if (h < 3) return;
  g.box(x, y, w, h, title, { fg: t.coord });
  const innerW = w - 4;
  body.slice(0, h - 2).forEach((line, i) => {
    g.text(x + 2, y + 1 + i, line, { fg: "#C9D1D9" }, innerW);
  });
}

function evalBar(g: Grid, x: number, y: number, w: number, h: number, v: GameView, t: Theme) {
  g.box(x, y, w, h, "Eval", { fg: t.coord });
  const innerW = w - 4;
  const share = v.mateIn !== null ? (v.mateIn > 0 ? 1 : 0) : whiteShare(v.evalCp ?? 0);
  const split = Math.round(innerW * share);
  for (let i = 0; i < innerW; i++) {
    const isWhite = i < split;
    g.put(x + 2 + i, y + 1, "█", { fg: isWhite ? t.whitePiece : t.blackPiece, bg: isWhite ? t.light : t.dark });
  }
  const label = evalLabel(v.evalCp, v.mateIn);
  g.text(x + 2, y + 2, `${label}${v.bestLine ? ` · ${v.bestLine}` : ""}`, { fg: t.coord }, innerW);
}

/** The whole game screen. Every panel is a box, so `assertBorders` can prove nothing overflowed. */
export function gameScreen(v: GameView): Grid {
  const g = new Grid(v.cols, v.rows);
  // The board shares the window with a title line, so it has to fit in one row
  // less than the full height. A window that fits the board but not its status
  // line steps down to the compact board rather than drawing off the bottom edge.
  let layout: Layout | null = null;
  try {
    const first = layoutFor(v.cols, v.rows);
    if (boardFootprint(first.tier).h <= v.rows - 1) layout = first;
  } catch {
    layout = null;
  }
  if (!layout && v.cols >= 18 && v.rows >= 9) {
    // A compact board is 18×9; below that there is genuinely nothing to draw.
    layout = { tier: "compact", panels: false };
  }
  if (!layout) {
    // Below the minimum the screen stays honest: wrap the reason instead of
    // clipping it to "terminal t" on a ten-column window.
    wrap(`terminal too small: ${v.cols}×${v.rows}`, v.cols)
      .slice(0, v.rows)
      .forEach((line, i) => g.text(0, i, line, { fg: "#E05252" }, v.cols));
    return g;
  }

  const compact = layout.tier === "compact";
  const { w: bw, h: bh } = boardFootprint(layout.tier);
  // A one-cell margin looks better, but at the exact width the board needs that
  // margin pushes the last wide glyph onto a column that does not exist.
  const boardX = v.cols > bw ? 1 : 0;
  const boardY = compact ? 0 : 1;
  if (!compact) {
    const head = ` tokenmate · level ${v.level} (${v.levelElo} elo) · ${v.opponent}${v.engine ? ` · ${v.engine}` : ""} `;
    g.text(0, 0, head, { fg: "#C9D1D9", bold: true }, v.cols);
  }

  drawBoard(g, boardX, boardY, v.fen, v.theme, {
    tier: layout.tier,
    ...v.marks,
    hints: v.hints,
    coord: v.theme.coord,
  });

  const px = boardX + bw + 2;
  const pw = Math.min(58, v.cols - px - 1);
  // The panel stack runs from row 1 to row 27 and the key hints own the last
  // row, so a window shorter than 29 rows gets the inline status instead of a
  // stack whose bottom box would be drawn past the edge. A compact board means
  // the window was already too small for the big one, so it never gets panels.
  const panelRoom = v.rows - 1 - 27 >= 0;
  if (compact || pw < 24 || !panelRoom) {
    g.text(0, boardY + bh, v.status, { fg: "#C9D1D9" }, v.cols);
    if (v.notice) g.text(0, boardY + bh + 1, v.notice, { fg: "#E05252" }, v.cols);
    g.assertBorders("compact game screen");
    return g;
  }

  {
    panel(g, px, 1, pw, 3, "Opponent", [v.status], v.theme);
    evalBar(g, px, 4, pw, 4, v, v.theme);

    const thoughtLines = v.thoughts ? wrap(v.thoughts, pw - 4) : ["(thinking appears here)"];
    panel(g, px, 8, pw, 8, "Thoughts", thoughtLines, v.theme);

    const analysis = v.bestLine ? [`best: ${v.bestLine}`] : ["waiting for the engine"];
    panel(g, px, 16, pw, 5, "Analysis", analysis, v.theme);

    const cap = capturedPieces(v.fen);
    panel(g, px, 21, pw, 4, "Captured", [cap.b.join(" ") || "—", cap.w.join(" ") || "—"], v.theme);

    const clocks = v.clocks
      ? [`white ${clock(v.clocks.white)}   black ${clock(v.clocks.black)}`]
      : ["no clock"];
    panel(g, px, 25, pw, 3, "Clock", clocks, v.theme);
  }

  const listY = boardY + bh;
  const listH = Math.min(v.rows - listY - 2, 9);
  if (listH >= 4) {
    g.box(boardX, listY, bw, listH, "Moves", { fg: v.theme.coord });
    formatMoves(v.moves, bw - 4).slice(-(listH - 2)).forEach((line, i) => {
      // The last line holds the most recent move, which is the one being played.
      const isCurrent = i === Math.min(formatMoves(v.moves, bw - 4).length, listH - 2) - 1;
      g.text(boardX + 2, listY + 1 + i, line, { fg: isCurrent ? "#FFFFFF" : "#C9D1D9", bold: isCurrent }, bw - 4);
    });
  }

  const foot = v.notice ?? "↑↓←→/hjkl move · space select · u undo · H hint · r resign · ? help · q quit";
  g.text(0, v.rows - 1, foot, { fg: v.notice ? "#E05252" : v.theme.coord }, v.cols);

  g.assertBorders("game screen");
  return g;
}

export const HELP: [string, string][] = [
  ["↑ ↓ ← → / h j k l", "move the cursor"],
  ["space / enter", "select a piece, then move"],
  ["esc", "deselect"],
  ["u", "take back your last move"],
  ["H", "hint — the engine's best move"],
  ["s", "cycle theme"],
  ["r", "resign"],
  ["?", "this help"],
  ["q", "quit"],
];

export function helpScreen(cols: number, rows: number, theme: Theme): Grid {
  const g = new Grid(cols, rows);
  const w = Math.max(12, Math.min(72, cols - 2));
  const h = Math.max(3, Math.min(HELP.length + 4, rows - 2));
  const x = Math.max(0, Math.floor((cols - w) / 2));
  const y = Math.max(0, Math.floor((rows - h) / 2));
  g.box(x, y, w, h, "Help", { fg: theme.coord });
  // Two columns need room for a 20-cell key plus a description; below that the
  // description would be painted over the right border, so keys go alone.
  const twoCol = w >= 44;
  HELP.slice(0, h - 2).forEach(([key, what], i) => {
    if (twoCol) {
      g.text(x + 2, y + 1 + i, key, { fg: "#FFFFFF", bold: true }, 19);
      g.text(x + 22, y + 1 + i, what, { fg: "#C9D1D9" }, w - 24);
    } else {
      g.text(x + 2, y + 1 + i, `${key} ${what}`, { fg: "#C9D1D9" }, w - 4);
    }
  });
  g.assertBorders("help screen");
  return g;
}

export type SetupChoice = { label: string; note?: string };

export function setupScreen(
  o: { cols: number; rows: number; theme: Theme; title: string; options: SetupChoice[]; selected: number; help?: string },
): Grid {
  const g = new Grid(o.cols, o.rows);
  const w = Math.min(72, Math.max(12, o.cols - 2));
  const h = Math.min(o.options.length + 5, Math.max(7, o.rows - 2));
  const x = Math.max(0, Math.floor((o.cols - w) / 2));
  const y = Math.max(0, Math.floor((o.rows - h) / 2));
  g.box(x, y, w, h, o.title, { fg: o.theme.coord });

  // The ladder is 20 rows and a 24-row terminal has room for far fewer, so the
  // window follows the selection. A list that simply truncated would hide level 20
  // exactly when someone is scrolling towards it.
  const contentRows = Math.max(1, h - 3);
  const overflows = o.options.length > contentRows;
  const visible = overflows ? Math.max(1, contentRows - 1) : contentRows;
  const first = Math.max(0, Math.min(o.selected - visible + 1, o.options.length - visible));

  o.options.slice(first, first + visible).forEach((opt, i) => {
    const on = first + i === o.selected;
    g.text(x + 2, y + 1 + i, `${on ? "▸" : " "} ${opt.label}`, { fg: on ? "#FFFFFF" : "#C9D1D9", bold: on }, w - 4);
    if (opt.note) g.text(x + Math.floor(w / 2), y + 1 + i, opt.note, { fg: o.theme.coord }, Math.floor(w / 2) - 2);
  });

  if (overflows) {
    const above = first > 0;
    const below = first + visible < o.options.length;
    const mark = `${above ? "↑" : " "}${below ? "↓" : " "}`.trim();
    if (mark) g.text(x + w - 3, y + h - 2, mark, { fg: o.theme.coord }, 1);
  }

  g.text(x + 2, y + h - 2, o.help ?? "↑↓ choose · enter select · esc back", { fg: o.theme.coord }, w - 6);
  g.assertBorders("setup screen");
  return g;
}

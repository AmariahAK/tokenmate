import { describe, expect, test } from "bun:test";
import { displayWidth } from "../src/ui/grid";
import { themes } from "../src/ui/theme";
import { toAnsi } from "../src/ui/ansi";
import {
  capturedPieces,
  clock,
  formatMoves,
  gameScreen,
  helpScreen,
  setupScreen,
  whiteShare,
  wrap,
  type GameView,
} from "../src/ui/screens";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const view = (o: Partial<GameView> = {}): GameView => ({
  cols: 96,
  rows: 37,
  theme: themes[0]!,
  fen: START,
  moves: ["e4", "e5", "Nf3", "Nc6"],
  ply: 4,
  evalCp: 34,
  mateIn: null,
  bestLine: "Nf3 Nc6 Bb5",
  thoughts: "Developing the knight toward the centre looks natural here.",
  status: "White to move",
  level: 7,
  levelElo: 950,
  opponent: "engine",
  engine: "Stockfish 19",
  clocks: { white: 178_000, black: 165_000 },
  ...o,
});

const eachLine = (g: { toText(): string }) => g.toText().split("\n");

describe("game screen", () => {
  test("every line is exactly the window width, so the frame cannot wrap", () => {
    for (const [cols, rows] of [
      [96, 37],
      [120, 40],
      [88, 30],
      [80, 24],
      [34, 25],
      [18, 9],
    ] as const) {
      for (const theme of themes) {
        const g = gameScreen(view({ cols, rows, theme }));
        const lines = eachLine(g);
        expect(lines).toHaveLength(rows);
        const bad = lines.map((l, i) => [i, displayWidth(l)] as const).filter(([, w]) => w !== cols);
        expect({ cols, rows, theme: theme.key, bad }).toEqual({ cols, rows, theme: theme.key, bad: [] });
      }
    }
  });

  test("panels appear at 96 columns and are named in the frame", () => {
    const text = gameScreen(view()).toText();
    for (const title of ["Eval", "Thoughts", "Analysis", "Captured", "Clock", "Moves"]) expect(text).toContain(title);
  });

  test("a medium 88-column terminal keeps narrower panels instead of dropping them", () => {
    const text = gameScreen(view({ cols: 88 })).toText();
    expect(text).toContain("Thoughts");
    expect(text).toContain("Moves");
  });

  test("a window too small to hold a board says so instead of drawing one", () => {
    expect(gameScreen(view({ cols: 10, rows: 5 })).toText()).toContain("terminal");
    const wider = gameScreen(view({ cols: 30, rows: 6 })).toText();
    expect(wider).toContain("terminal too small");
    expect(wider).toContain("30×6");
  });

  test("below three lines of panel room the board still renders and borders hold", () => {
    const g = gameScreen(view({ cols: 34, rows: 25 }));
    expect(g.toText()).toContain("White to move");
  });

  test("the head line names the level with the Elo it actually plays", () => {
    expect(gameScreen(view()).toText()).toContain("level 7 (950 elo)");
  });

  test("a notice replaces the key hints, so a fallback is never silent", () => {
    const text = gameScreen(view({ notice: "model played an illegal move — engine moved instead" })).toText();
    expect(text).toContain("engine moved instead");
  });

  test("the last move in the list is the bolded current one", () => {
    // Enough moves to wrap the list over several lines, so "last line is bold"
    // and "earlier lines are not" are genuinely different assertions.
    const long = ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7", "Re1", "b5", "Bb3", "d6", "c3", "O-O"];
    const g = gameScreen(view({ moves: long, ply: 16 }));
    const textRows = eachLine(g)
      .map((line, y) => ({ line, y }))
      // The list's bottom border is at y=34 and is not a move line, so the rows
      // are the ones that start with a move number.
      .filter(({ y }) => y >= 27 && y <= 34 && /[0-9]/.test(g.cellAt(3, y)?.ch ?? ""));
    expect(textRows.length).toBeGreaterThan(1);
    const first = textRows[0]!.y;
    const last = textRows[textRows.length - 1]!.y;
    expect(g.cellAt(3, first)?.bold).toBe(false);
    expect(g.cellAt(3, last)?.bold).toBe(true);
  });
});

describe("panel maths", () => {
  test("eval bar is an even split at 0 and saturates with a big advantage", () => {
    expect(whiteShare(0)).toBe(0.5);
    expect(whiteShare(400)).toBeGreaterThan(0.9);
    expect(whiteShare(-400)).toBeLessThan(0.1);
  });

  test("captured pieces are what the FEN is missing", () => {
    const c = capturedPieces("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    expect(c.w).toEqual([]);
    expect(c.b).toEqual([]);
    const after = capturedPieces("rnbqkbn1/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    expect(after.b).toEqual(["r"]);
  });

  test("clocks format and never show negative time", () => {
    expect(clock(178_000)).toBe("02:58");
    expect(clock(9_000)).toBe("00:09");
    expect(clock(-5_000)).toBe("00:00");
    expect(clock(null)).toBe("--:--");
  });

  test("move list wraps on the panel width and keeps move numbers", () => {
    const moves = ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6"];
    const wide = formatMoves(moves, 80);
    expect(wide).toHaveLength(1);
    expect(wide[0]).toContain("1.e4 e5");
    const narrow = formatMoves(moves, 12);
    expect(narrow.length).toBeGreaterThan(1);
    for (const line of narrow) expect(displayWidth(line)).toBeLessThanOrEqual(12);
  });

  test("wrap does not lose words", () => {
    const text = "the quick brown fox jumps over the lazy dog";
    const joined = wrap(text, 10).join(" ").replace(/\s+/g, " ");
    expect(joined).toBe(text);
  });
});

describe("help and setup", () => {
  test("help lists every shortcut and fits the window", () => {
    const g = helpScreen(96, 37, themes[0]!);
    const text = g.toText();
    for (const key of ["u", "h", "?", "q"]) expect(text).toContain(key);
    expect(text).toContain("resign");
    for (const line of eachLine(g)) expect(displayWidth(line)).toBe(96);
  });

  test("help on a tiny window does not throw", () => {
    expect(() => helpScreen(20, 6, themes[0]!)).not.toThrow();
  });

  test("setup marks the selected row and survives a window smaller than the list", () => {
    const g = setupScreen({
      cols: 96,
      rows: 12,
      theme: themes[0]!,
      title: "Level",
      options: Array.from({ length: 20 }, (_, i) => ({ label: `Level ${i + 1}`, value: String(i + 1) })),
      selected: 6,
    });
    const text = g.toText();
    expect(text).toContain("▸ Level 7");
    expect(text).not.toContain("Level 20");
  });
});

describe("ansi", () => {
  test("truecolor emits spans and always resets", () => {
    const out = toAnsi(gameScreen(view({ cols: 40, rows: 12 })));
    expect(out).toContain("\x1b[");
    expect(out.endsWith("\x1b[0m")).toBe(true);
  });

  test("no-colour mode is plain text with no escapes at all", () => {
    const plain = toAnsi(gameScreen(view({ cols: 40, rows: 12 })), "none");
    expect(plain).not.toContain("\x1b");
  });

  test("256-colour is different from truecolor but keeps the same characters", () => {
    const g = gameScreen(view({ cols: 40, rows: 12 }));
    const tc = toAnsi(g, "truecolor");
    const c256 = toAnsi(g, "256");
    expect(c256).not.toBe(tc);
    expect(c256).toContain("38;5;");
    expect(c256.replace(/\x1b\[[0-9;]*m/g, "")).toBe(tc.replace(/\x1b\[[0-9;]*m/g, ""));
  });

  test("a continuation cell is not duplicated, so widths stay true", () => {
    const g = gameScreen(view());
    const plain = toAnsi(g, "none");
    for (const line of plain.split("\n")) expect(displayWidth(line)).toBe(96);
  });
});

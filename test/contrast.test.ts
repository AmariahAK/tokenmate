import { describe, expect, test } from "bun:test";
import { ratio } from "../src/ui/contrast";
import { STATES, square, themes, type Theme } from "../src/ui/theme";

// WCAG 1.4.11 asks 3:1 for graphics that carry meaning. A chess piece is the
// meaning, so every piece fill must clear 3:1 on every square state — not just
// on the plain squares the theme was eyeballed on.
const worst = (t: Theme) => {
  let min = Infinity;
  let where = "";
  for (const isLight of [true, false])
    for (const state of STATES) {
      const bg = square(t, isLight, state);
      for (const [side, fill] of [
        ["white", t.whitePiece],
        ["black", t.blackPiece],
      ] as const) {
        const r = ratio(fill, bg);
        if (r < min) {
          min = r;
          where = `${side} on ${state}/${isLight ? "light" : "dark"}`;
        }
      }
    }
  return { min, where };
};

describe("theme contrast", () => {
  test("the ratio is the WCAG one", () => {
    expect(ratio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    expect(ratio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(ratio("#777777", "#FFFFFF")).toBeCloseTo(4.478, 3);
    expect(ratio("#123456", "#123456")).toBeCloseTo(1, 5);
  });

  test("every piece clears 3:1 on every square state of every theme (mono exempt: 2.5:1)", () => {
    const report = themes.map((t) => ({ key: t.key, ...worst(t) }));
    // Mono deliberately trades dual-side contrast for checkerboard legibility;
    // its pieces are separated by case (K vs k) rather than colour alone.
    const strict = report.filter((r) => r.key !== "mono" && r.min < 3);
    const mono = report.find((r) => r.key === "mono")!;
    expect(strict).toEqual([]);
    expect(mono.min).toBeGreaterThan(2.5);
  });

  test("the two skins that carry the design's margin stay where they were measured", () => {
    // These are the tight ones: neon is the inverse board, slate the default. If a
    // palette derivation moves, it moves here first — that is what this catches.
    expect(worst(themes.find((t) => t.key === "neon")!).min).toBeCloseTo(3.10, 1);
    expect(worst(themes.find((t) => t.key === "slate")!).min).toBeCloseTo(3.49, 1);
  });

  test("a theme that hides its pieces fails the same check", () => {
    // Mutation: the gate has to fail when a piece fill is the square's colour.
    const base = themes[0]!;
    const broken: Theme = { ...base, key: "broken", blackPiece: square(base, false, "none") };
    expect(worst(broken).min).toBeCloseTo(1, 5);
    expect(worst(broken).min).toBeLessThan(3);
  });

  test("a highlight changes the square without spending the contrast budget", () => {
    // Highlights are hue shifts at constant luminance, so the ratio against a piece
    // must not collapse on the highlighted squares specifically.
    for (const t of themes)
      for (const state of STATES.filter((s) => s !== "none"))
        for (const isLight of [true, false]) {
          const plain = ratio(t.blackPiece, square(t, isLight, "none"));
          const marked = ratio(t.blackPiece, square(t, isLight, state));
          expect(marked).toBeGreaterThan(plain * 0.5);
        }
  });
});

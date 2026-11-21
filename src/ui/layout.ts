import { boardFootprint, type Tier } from "./board";

export type { Tier };

export type Layout = {
  tier: Tier;
  /** Side panels dock right of the board; without room, the board is all there is. */
  panels: boolean;
};

// Width the side panels need at their widest: eval bar, move list, thoughts and
// analysis stacked in 58 columns, which is what the design measured at 96 total.
export const PANEL_W = 58;
const GAP = 2;

const footprint = (tier: Tier) => boardFootprint(tier);

const fits = (tier: Tier, cols: number, rows: number) => {
  const { w, h } = footprint(tier);
  return cols >= w && rows >= h;
};

/**
 * Pick a board tier for the terminal. Bigger squares win whenever they fit,
 * because the whole point of the boxed board is piece size — but `wide` is only
 * chosen when the panels fit beside it too, since a 6×3 board with no room for
 * the move list is worse than a 4×3 board with one.
 */
export function layoutFor(cols: number, rows: number): Layout {
  const wide = footprint("wide");
  if (cols >= wide.w + GAP + PANEL_W && fits("wide", cols, rows)) return { tier: "wide", panels: true };
  if (fits("boxed", cols, rows)) return { tier: "boxed", panels: cols >= footprint("boxed").w + GAP + PANEL_W };
  if (fits("compact", cols, rows)) return { tier: "compact", panels: false };
  const min = footprint("compact");
  throw new Error(
    `terminal is ${cols}×${rows}; tokenmate needs at least ${min.w}×${min.h}. Try a smaller font or a wider window.`,
  );
}

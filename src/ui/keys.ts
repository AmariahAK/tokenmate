import type { PromotionPiece } from "../game/game.ts";

export interface KeyInput {
  name: string;
  ctrl?: boolean;
}

export type KeyMode = "board" | "promotion";

export type Action =
  | { type: "cursor"; dx: number; dy: number }
  | { type: "select" }
  | { type: "cancel" }
  | { type: "undo" }
  | { type: "flip" }
  | { type: "new" }
  | { type: "menu" }
  | { type: "pieceStyle" }
  | { type: "scroll"; delta: number }
  | { type: "quit" }
  | { type: "promote"; piece: PromotionPiece };

const CURSOR_KEYS: Record<string, [number, number]> = {
  up: [0, 1],
  k: [0, 1],
  down: [0, -1],
  j: [0, -1],
  left: [-1, 0],
  h: [-1, 0],
  right: [1, 0],
  l: [1, 0],
};

export const PROMOTION_KEYS: Record<string, PromotionPiece> = {
  q: "q",
  r: "r",
  b: "b",
  k: "n",
};

export function keyToAction(key: KeyInput, mode: KeyMode): Action | null {
  if (key.ctrl && key.name === "c") return { type: "quit" };
  if (key.name === "escape") return { type: "cancel" };

  if (mode === "promotion") {
    const piece = PROMOTION_KEYS[key.name];
    return piece ? { type: "promote", piece } : null;
  }

  const delta = CURSOR_KEYS[key.name];
  if (delta) return { type: "cursor", dx: delta[0], dy: delta[1] };

  switch (key.name) {
    case "return":
    case "enter":
    case "space":
      return { type: "select" };
    case "u":
      return { type: "undo" };
    case "f":
      return { type: "flip" };
    case "n":
      return { type: "new" };
    case "m":
      return { type: "menu" };
    case "p":
      return { type: "pieceStyle" };
    case "pageup":
      return { type: "scroll", delta: -5 };
    case "pagedown":
      return { type: "scroll", delta: 5 };
    case "q":
      return { type: "quit" };
    default:
      return null;
  }
}

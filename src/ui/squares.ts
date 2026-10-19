import type { Square } from "../game/game.ts";

export const FILES = "abcdefgh";

export function toSquare(file: number, rank: number): Square {
  return `${FILES[file]}${rank + 1}` as Square;
}

export function fileOf(square: Square): number {
  return FILES.indexOf(square[0] as string);
}

export function rankOf(square: Square): number {
  return Number(square[1]) - 1;
}

export function moveSquare(square: Square, dx: number, dy: number, flipped: boolean): Square {
  const sign = flipped ? -1 : 1;
  const file = Math.min(7, Math.max(0, fileOf(square) + dx * sign));
  const rank = Math.min(7, Math.max(0, rankOf(square) + dy * sign));
  return toSquare(file, rank);
}

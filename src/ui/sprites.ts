// Block-art chess piece sprites, 4 columns × 3 rows.
//
// Using ▀ (upper half) and ▄ (lower half) as "pixels" gives 4×6 effective
// resolution inside 4×3 character cells. Each character can show:
//   ▀  = top half filled      ▄  = bottom half filled
//   █  = both halves filled   ▐  = right half filled
//   ▌  = left half filled       = empty (transparent)
//
// The sprites are colour-neutral — the renderer paints non-space cells
// in the piece's fg colour on the square's bg.

export type Sprite = [string, string, string]; // 3 rows, each exactly 4 chars

// ── Piece silhouettes ────────────────────────────────────────────────
//
// Each piece is designed to be instantly recognisable:
//
//   King   — cross on top, tapered body, wide base
//   Queen  — crown with 3 points, tapered body, wide base
//   Rook   — crenellations (3 merlons), solid tower, wide base
//   Bishop — tall pointed hat (mitre), diagonal slash, medium base
//   Knight — horse head profile facing right, thick neck
//   Pawn   — round head, thin neck, flared base

const KING: Sprite = [
  " ╬╬ ",  //  cross / crown ornament
  " ▐▌ ",  //  tapered body
  "▐██▌",  //  wide base
];

const QUEEN: Sprite = [
  "▟██▙",  //  solid crown with flared top
  " ▐▌ ",  //  tapered body
  "▐██▌",  //  wide base
];

const ROOK: Sprite = [
  "█▀▀█",  //  crenellations — two merlons with open top
  "▐██▌",  //  solid tower
  "████",  //  widest base
];

const BISHOP: Sprite = [
  " ▄▀ ",  //  pointed mitre with slash
  " ██ ",  //  solid body
  "▐██▌",  //  wide base
];

const KNIGHT: Sprite = [
  "▄██▀",  //  horse head profile
  " ██ ",  //  thick neck
  "▐██▌",  //  wide base
];

const PAWN: Sprite = [
  " ▄▄ ",  //  round head
  " ██ ",  //  body
  "▐██▌",  //  flared base
];

export const SPRITES: Record<string, Sprite> = {
  k: KING,
  q: QUEEN,
  r: ROOK,
  b: BISHOP,
  n: KNIGHT,
  p: PAWN,
};

// Validate at load time
for (const [name, rows] of Object.entries(SPRITES)) {
  if (rows.length !== 3) throw new Error(`sprite ${name}: expected 3 rows, got ${rows.length}`);
  for (let i = 0; i < 3; i++) {
    if ([...rows[i]!].length !== 4)
      throw new Error(`sprite ${name} row ${i}: expected 4 chars, got ${[...rows[i]!].length}`);
  }
}

// Block-art chess piece sprites.
// Each piece is a 4-column × 3-row grid of characters drawn with Unicode
// block elements (█ ▀ ▄ ▐ ▌ ▘ ▝ ▖ ▗) that fill the square and give
// recognisable silhouettes at the 4×3 tier.
//
// The sprites are colour-neutral — they carry only shape. The renderer
// paints every non-space cell in the piece's fg colour on the square's bg.
//
// Design constraints:
//   - exactly 4 columns, 3 rows (matches TIERS.boxed)
//   - spaces are transparent (show the square colour)
//   - no East-Asian-wide characters (each cell is 1 column)
//   - each piece must be visually distinct from every other

export type Sprite = [string, string, string]; // 3 rows, each exactly 4 chars

// ── Piece silhouettes ────────────────────────────────────────────────
// The shapes are designed so every piece is recognisable at a glance:
//   King   — wide flat crown with cross
//   Queen  — three-pointed crown (corner dots)
//   Rook   — two battlements with gap between
//   Bishop — pointed top, narrow body
//   Knight — asymmetric head jutting right
//   Pawn   — small round head, narrow stem

const KING: Sprite = [
  "▐▀▀▌",  //  wide flat crown
  " ▐▌ ",  //  narrow waist
  "▐██▌",  //  wide base
];

const QUEEN: Sprite = [
  "▘▀▀▝",  //  three points (corners + top)
  " ▐▌ ",  //  narrow waist
  "▐██▌",  //  wide base
];

const ROOK: Sprite = [
  "█  █",  //  two battlements with gap
  "▐██▌",  //  solid tower
  "████",  //  wide base
];

const BISHOP: Sprite = [
  " ▄▄ ",  //  pointed mitre
  " ▐▌ ",  //  narrow body
  " ██ ",  //  medium base
];

const KNIGHT: Sprite = [
  " ▄█▌",  //  head jutting right
  " ██ ",  //  thick neck
  "▐██▌",  //  wide base
];

const PAWN: Sprite = [
  " ▐▌ ",  //  small round head
  " ▐▌ ",  //  narrow stem
  " ██ ",  //  medium base
];

// Map from piece type letter to sprite
export const SPRITES: Record<string, Sprite> = {
  k: KING,
  q: QUEEN,
  r: ROOK,
  b: BISHOP,
  n: KNIGHT,
  p: PAWN,
};

// Validate at load time — every sprite must be exactly 3 rows of 4 chars
for (const [name, rows] of Object.entries(SPRITES)) {
  if (rows.length !== 3) throw new Error(`sprite ${name}: expected 3 rows, got ${rows.length}`);
  for (let i = 0; i < 3; i++) {
    if ([...rows[i]!].length !== 4)
      throw new Error(`sprite ${name} row ${i}: expected 4 chars, got ${[...rows[i]!].length}`);
  }
}

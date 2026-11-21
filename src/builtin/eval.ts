import { BISHOP, BLACK, KING, KNIGHT, PAWN, QUEEN, ROOK, WHITE, fileOf, rankOf, type Color, type Position } from "./position";

// Material plus piece-square tables, which is the classic "simplified evaluation"
// shape: enough to play a coherent game, small enough to read, and — because it is
// arithmetic on our own board — it cannot be stronger than the search around it.
export const VALUE: Record<number, number> = { [PAWN]: 100, [KNIGHT]: 320, [BISHOP]: 330, [ROOK]: 500, [QUEEN]: 900, [KING]: 0 };

// Tables are written the way a board is drawn: first row is rank 8. `pstIndex`
// mirrors them for black, so one table serves both colours.
const PAWN_PST = [
  0, 0, 0, 0, 0, 0, 0, 0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
  5, 5, 10, 25, 25, 10, 5, 5,
  0, 0, 0, 20, 20, 0, 0, 0,
  5, -5, -10, 0, 0, -10, -5, 5,
  5, 10, 10, -20, -20, 10, 10, 5,
  0, 0, 0, 0, 0, 0, 0, 0,
];

const KNIGHT_PST = [
  -50, -40, -30, -30, -30, -30, -40, -50,
  -40, -20, 0, 0, 0, 0, -20, -40,
  -30, 0, 10, 15, 15, 10, 0, -30,
  -30, 5, 15, 20, 20, 15, 5, -30,
  -30, 0, 15, 20, 20, 15, 0, -30,
  -30, 5, 10, 15, 15, 10, 5, -30,
  -40, -20, 0, 5, 5, 0, -20, -40,
  -50, -40, -30, -30, -30, -30, -40, -50,
];

const BISHOP_PST = [
  -20, -10, -10, -10, -10, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 10, 10, 5, 0, -10,
  -10, 5, 5, 10, 10, 5, 5, -10,
  -10, 0, 10, 10, 10, 10, 0, -10,
  -10, 10, 10, 10, 10, 10, 10, -10,
  -10, 5, 0, 0, 0, 0, 5, -10,
  -20, -10, -10, -10, -10, -10, -10, -20,
];

const ROOK_PST = [
  0, 0, 0, 0, 0, 0, 0, 0,
  5, 10, 10, 10, 10, 10, 10, 5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  0, 0, 0, 5, 5, 0, 0, 0,
];

const QUEEN_PST = [
  -20, -10, -10, -5, -5, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 5, 5, 5, 0, -10,
  -5, 0, 5, 5, 5, 5, 0, -5,
  0, 0, 5, 5, 5, 5, 0, -5,
  -10, 5, 5, 5, 5, 5, 0, -10,
  -10, 0, 5, 0, 0, 0, 0, -10,
  -20, -10, -10, -5, -5, -10, -10, -20,
];

const KING_PST = [
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -20, -30, -30, -40, -40, -30, -30, -20,
  -10, -20, -20, -20, -20, -20, -20, -10,
  20, 20, 0, 0, 0, 0, 20, 20,
  20, 30, 10, 0, 0, 10, 30, 20,
];

const TABLES: Record<number, number[]> = {
  [PAWN]: PAWN_PST,
  [KNIGHT]: KNIGHT_PST,
  [BISHOP]: BISHOP_PST,
  [ROOK]: ROOK_PST,
  [QUEEN]: QUEEN_PST,
  [KING]: KING_PST,
};

const pstIndex = (sq: number, color: Color): number =>
  color === WHITE ? (7 - rankOf(sq)) * 8 + fileOf(sq) : rankOf(sq) * 8 + fileOf(sq);

export const pieceValue = (type: number): number => VALUE[type] ?? 0;

export const pstValue = (type: number, sq: number, color: Color): number => TABLES[type]?.[pstIndex(sq, color)] ?? 0;

/**
 * Score in centipawns from the side to move. Centipawn scores are what the ladder's
 * loss weighting and the eval bar both consume, so there is no separate scale.
 */
export function evaluate(pos: Position): number {
  let score = 0;
  const board = pos.board;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const piece = board[sq] ?? 0;
    if (piece === 0) continue;
    const color: Color = piece > 0 ? WHITE : BLACK;
    const type = Math.abs(piece);
    const value = pieceValue(type) + pstValue(type, sq, color);
    score += color === WHITE ? value : -value;
  }
  // the side to move is very slightly better off, which stops the search dawdling
  const tempo = 8;
  return pos.side === WHITE ? score + tempo : -score + tempo;
}

import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";

export type { Color, PieceSymbol, Square };

export type PromotionPiece = "q" | "r" | "b" | "n";

export type DrawReason =
  | "stalemate"
  | "insufficient material"
  | "threefold repetition"
  | "fifty-move rule";

export type GameStatus =
  | { kind: "playing" }
  | { kind: "check" }
  | { kind: "checkmate"; winner: Color }
  | { kind: "draw"; reason: DrawReason };

export interface BoardPiece {
  color: Color;
  type: PieceSymbol;
}

export interface MoveRecord {
  from: Square;
  to: Square;
  san: string;
  color: Color;
}

export interface GameSnapshot {
  board: (BoardPiece | null)[][];
  turn: Color;
  status: GameStatus;
  history: string[];
  lastMove: MoveRecord | null;
  fen: string;
}

export class Game {
  private chess: Chess;

  constructor(fen?: string) {
    this.chess = new Chess(fen);
  }

  turn(): Color {
    return this.chess.turn();
  }

  pieceAt(square: Square): BoardPiece | null {
    return this.chess.get(square) ?? null;
  }

  legalMoves(): MoveRecord[] {
    return this.chess.moves({ verbose: true }).map(toRecord);
  }

  legalTargets(from: Square): Square[] {
    return [...new Set(this.chess.moves({ square: from, verbose: true }).map((m) => m.to))];
  }

  needsPromotion(from: Square, to: Square): boolean {
    return this.chess
      .moves({ square: from, verbose: true })
      .some((m) => m.to === to && m.isPromotion());
  }

  move(from: Square, to: Square, promotion?: PromotionPiece): MoveRecord | null {
    if (this.isOver()) return null;
    try {
      return toRecord(this.chess.move({ from, to, promotion }));
    } catch {
      return null;
    }
  }

  undo(): MoveRecord | null {
    const undone = this.chess.undo();
    return undone ? toRecord(undone) : null;
  }

  reset(): void {
    this.chess.reset();
  }

  status(): GameStatus {
    const c = this.chess;
    if (c.isCheckmate()) return { kind: "checkmate", winner: c.turn() === "w" ? "b" : "w" };
    if (c.isStalemate()) return { kind: "draw", reason: "stalemate" };
    if (c.isInsufficientMaterial()) return { kind: "draw", reason: "insufficient material" };
    if (c.isThreefoldRepetition()) return { kind: "draw", reason: "threefold repetition" };
    if (c.isDrawByFiftyMoves()) return { kind: "draw", reason: "fifty-move rule" };
    if (c.isCheck()) return { kind: "check" };
    return { kind: "playing" };
  }

  isOver(): boolean {
    return this.chess.isGameOver();
  }

  history(): string[] {
    return this.chess.history();
  }

  lastMove(): MoveRecord | null {
    const last = this.chess.history({ verbose: true }).at(-1);
    return last ? toRecord(last) : null;
  }

  fen(): string {
    return this.chess.fen();
  }

  pgn(): string {
    return this.chess.pgn();
  }

  snapshot(): GameSnapshot {
    return {
      board: this.chess
        .board()
        .map((rank) => rank.map((p) => (p ? { color: p.color, type: p.type } : null))),
      turn: this.turn(),
      status: this.status(),
      history: this.history(),
      lastMove: this.lastMove(),
      fen: this.fen(),
    };
  }
}

function toRecord(m: Move): MoveRecord {
  return { from: m.from, to: m.to, san: m.san, color: m.color };
}

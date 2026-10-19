import { Chess, type Move, type PieceSymbol } from "chess.js";
import type { MoveRequest } from "../game/player.ts";

export type BotLevel = "easy" | "medium" | "hard";

export const BOT_LEVELS: BotLevel[] = ["easy", "medium", "hard"];

interface LevelSettings {
  depth: number;
  margin: number;
  blunderChance: number;
}

const SETTINGS: Record<BotLevel, LevelSettings> = {
  easy: { depth: 1, margin: 120, blunderChance: 0.25 },
  medium: { depth: 2, margin: 30, blunderChance: 0.05 },
  hard: { depth: 3, margin: 0, blunderChance: 0 },
};

const VALUES: Record<PieceSymbol, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

const MATE = 100_000;

const PST: Record<PieceSymbol, number[]> = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5,
    10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20,
    -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10,
    0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10,
    5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0,
    -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10,
    -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0,
    0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0,
    5, 5, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0,
    0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40,
    -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30,
    -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0,
    10, 30, 20,
  ],
};

function evaluate(chess: Chess): number {
  let score = 0;
  const board = chess.board();
  for (let row = 0; row < 8; row++) {
    const rank = board[row];
    if (!rank) continue;
    for (let col = 0; col < 8; col++) {
      const piece = rank[col];
      if (!piece) continue;
      const index = piece.color === "w" ? row * 8 + col : (7 - row) * 8 + col;
      const value = VALUES[piece.type] + (PST[piece.type][index] ?? 0);
      score += piece.color === "w" ? value : -value;
    }
  }
  return chess.turn() === "w" ? score : -score;
}

function ordered(moves: Move[]): Move[] {
  const weight = (m: Move) =>
    (m.captured ? 10 * VALUES[m.captured] - VALUES[m.piece] : 0) + (m.promotion ? 800 : 0);
  return moves.sort((a, b) => weight(b) - weight(a));
}

function negamax(chess: Chess, depth: number, alpha: number, beta: number, ply: number): number {
  if (depth === 0) return evaluate(chess);
  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) return chess.inCheck() ? -MATE + ply : 0;

  let best = -Infinity;
  for (const move of ordered(moves)) {
    chess.move(move);
    const score = -negamax(chess, depth - 1, -beta, -alpha, ply + 1);
    chess.undo();
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export function chooseMove(fen: string, level: BotLevel, random = Math.random): MoveRequest {
  const settings = SETTINGS[level];
  const chess = new Chess(fen);
  const moves = ordered(chess.moves({ verbose: true }));
  if (moves.length === 0) throw new Error("No legal moves in this position.");

  let pick: Move | undefined;
  if (random() < settings.blunderChance) {
    pick = moves[Math.floor(random() * moves.length)];
  } else {
    let best = -Infinity;
    const scored: { move: Move; score: number }[] = [];
    for (const move of moves) {
      chess.move(move);
      const alpha = best - settings.margin - 1;
      const score = -negamax(chess, settings.depth - 1, -Infinity, -alpha, 1);
      chess.undo();
      scored.push({ move, score });
      if (score > best) best = score;
    }
    const pool = scored.filter((s) => s.score >= best - settings.margin);
    pick = pool[Math.floor(random() * pool.length)]?.move;
  }
  if (!pick) throw new Error("No move selected.");

  const { from, to, promotion } = pick;
  return promotion ? { from, to, promotion: promotion as MoveRequest["promotion"] } : { from, to };
}

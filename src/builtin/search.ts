import { evaluate, pieceValue } from "./eval";
import { F_CAPTURE, F_EP, PAWN, flagOf, fromOf, promoOf, toOf, type Move, type Position } from "./position";

// Negamax with alpha-beta, a quiescence search at the horizon and iterative
// deepening. No transposition table and no null-move pruning on purpose: both are
// strength features, and strength here is bounded by a per-move time budget anyway.
export const MATE = 30000;

export type SearchResult = { move: Move; score: number; pv: Move[] };

export type SearchOptions = {
  /** hard depth cap */
  maxDepth: number;
  /** wall-clock cap in ms; the search stops at whichever limit comes first */
  movetime: number;
  /** how many root moves to score; 1 is a plain best-move search */
  multiPv: number;
};

type Ctx = { nodes: number; deadline: number; aborted: boolean };

const victimOf = (pos: Position, m: Move): number =>
  flagOf(m) & F_EP ? PAWN : Math.abs(pos.board[toOf(m)] ?? 0);

/** Captures first, then promotions, then nothing — MVV-LVA on the rest. */
const orderScore = (pos: Position, m: Move): number => {
  const promo = promoOf(m);
  const flag = flagOf(m);
  if (flag & F_CAPTURE) {
    const attacker = Math.abs(pos.board[fromOf(m)] ?? 0);
    return 100_000 + pieceValue(victimOf(pos, m)) * 10 - pieceValue(attacker) + (promo ? pieceValue(promo) : 0);
  }
  if (promo) return 90_000 + pieceValue(promo);
  return 0;
};

const scoreMoves = (pos: Position, moves: Move[]): Move[] =>
  moves.map((m) => [m, orderScore(pos, m)] as const).sort((a, b) => b[1] - a[1]).map(([m]) => m);

function outOfTime(ctx: Ctx): boolean {
  if (Date.now() > ctx.deadline) ctx.aborted = true;
  return ctx.aborted;
}

function quiescence(pos: Position, alpha: number, beta: number, ply: number, ctx: Ctx): number {
  ctx.nodes++;
  if ((ctx.nodes & 1023) === 0 && outOfTime(ctx)) return alpha;
  const stand = evaluate(pos);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  if (ply > 40) return alpha;
  const moves = pos.generateLegal().filter((m) => flagOf(m) & F_CAPTURE || promoOf(m) !== 0);
  for (const m of scoreMoves(pos, moves)) {
    pos.makeMove(m);
    const score = -quiescence(pos, -beta, -alpha, ply + 1, ctx);
    pos.unmakeMove(m);
    if (ctx.aborted) return alpha;
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(
  pos: Position,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  ctx: Ctx,
  pv: Move[],
): number {
  ctx.nodes++;
  if ((ctx.nodes & 1023) === 0 && outOfTime(ctx)) return alpha;
  if (depth <= 0) return quiescence(pos, alpha, beta, ply, ctx);

  const moves = pos.generateLegal();
  if (moves.length === 0) return pos.inCheck() ? -(MATE - ply) : 0;

  let best = -Infinity;
  for (const m of scoreMoves(pos, moves)) {
    const childPv: Move[] = [];
    pos.makeMove(m);
    const score = -negamax(pos, depth - 1, -beta, -alpha, ply + 1, ctx, childPv);
    pos.unmakeMove(m);
    if (ctx.aborted) return best === -Infinity ? alpha : best;
    if (score > best) {
      best = score;
      if (score > alpha) {
        alpha = score;
        pv.length = 0;
        pv.push(m, ...childPv);
      }
    }
    if (alpha >= beta) break;
  }
  return best;
}

/**
 * Every root move, scored best-first. Scores are exact (a full window per move)
 * because the level ladder does arithmetic on them: loss-weighted sampling needs to
 * know what the *second* best move gives up, not merely that it is worse.
 */
export function searchRoot(pos: Position, opts: SearchOptions): SearchResult[] {
  const ctx: Ctx = { nodes: 0, deadline: Date.now() + opts.movetime, aborted: false };
  const rootMoves = pos.generateLegal();
  if (rootMoves.length === 0) return [];

  const scoring =
    opts.multiPv <= 1
      ? // one move is wanted: narrow the window and let alpha-beta do its job
        null
      : rootMoves;

  let ordered: SearchResult[] = rootMoves.map((move) => ({ move, score: -Infinity, pv: [] }));
  let completed: SearchResult[] = ordered;

  for (let depth = 1; depth <= opts.maxDepth; depth++) {
    const next: SearchResult[] = [];
    let alpha = -Infinity;

    if (scoring) {
      for (const entry of ordered) {
        const pv: Move[] = [];
        pos.makeMove(entry.move);
        const score = -negamax(pos, depth - 1, -Infinity, Infinity, 1, ctx, pv);
        pos.unmakeMove(entry.move);
        if (ctx.aborted) break;
        next.push({ move: entry.move, score, pv });
      }
    } else {
      for (const entry of ordered) {
        const pv: Move[] = [];
        pos.makeMove(entry.move);
        const score = -negamax(pos, depth - 1, -Infinity, -alpha, 1, ctx, pv);
        pos.unmakeMove(entry.move);
        if (ctx.aborted) break;
        next.push({ move: entry.move, score, pv });
        if (score > alpha) alpha = score;
      }
    }

    if (ctx.aborted) break;
    next.sort((a, b) => b.score - a.score);
    // carry the previous depth's scores for moves that were cut off
    for (const entry of next) {
      const before = ordered.find((o) => o.move === entry.move);
      if (before && entry.score === -Infinity) entry.score = before.score;
    }
    completed = next;
    ordered = next;
    if (Math.abs(completed[0]?.score ?? 0) > MATE - 100) break; // mate found, no point going deeper
  }

  const ranked = completed.sort((a, b) => b.score - a.score);
  return ranked.slice(0, Math.max(1, opts.multiPv));
}

export type { Color } from "./position";

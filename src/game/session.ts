import {
  Chess,
  DEFAULT_POSITION,
  SQUARES,
  validateFen,
  type Color,
  type Move,
  type PieceSymbol,
  type Square,
} from "chess.js";
import { makeRng, type Rng } from "../util/rng";

// Invariant 3 lives here: `chess.js` is the only thing that decides whether a move
// is legal. This module never re-implements a rule, and a move chess.js refuses is
// never recorded — not in the history, not in the PGN, not on the board.

export type PgnResult = "1-0" | "0-1" | "1/2-1/2" | "*";

export const COLORS = ["w", "b"] as const;

export const GAME_OVER_REASONS = [
  "checkmate",
  "stalemate",
  "insufficient-material",
  "threefold-repetition",
  "fifty-move",
  "resignation",
  "agreed-draw",
  "timeout",
] as const;

export type GameOverReason = (typeof GAME_OVER_REASONS)[number];

export type Outcome = {
  reason: GameOverReason;
  /** `null` for every draw. */
  winner: Color | null;
};

/** One recorded ply. Written only from a `Move` chess.js produced. */
export type Ply = {
  ply: number;
  san: string;
  /** `from` + `to` + promotion, which is what UCI speaks. */
  uci: string;
  /** Position after the move. */
  fen: string;
  from: Square;
  to: Square;
  color: Color;
  piece: PieceSymbol;
  captured?: PieceSymbol;
  promotion?: PieceSymbol;
};

/**
 * The list a model will be forced to choose from, so every field is explicit:
 * nothing downstream has to re-derive it from a SAN string.
 */
export type LegalMove = {
  san: string;
  uci: string;
  from: Square;
  to: Square;
  color: Color;
  piece: PieceSymbol;
  captured?: PieceSymbol;
  promotion?: PieceSymbol;
  capture: boolean;
  enPassant: boolean;
  castle: "kingside" | "queenside" | null;
};

export type MoveInput = string | { from: string; to: string; promotion?: string };

export type MoveRejection = "illegal" | "not-your-turn" | "game-over" | "bad-input";

export type MoveRejected = { ok: false; reason: MoveRejection; detail: string };

export type MoveAccepted = Ply & { ok: true; result: PgnResult };

export type MoveResult = MoveAccepted | MoveRejected;

export type ClockConfig = { initialMs: number; incrementMs: number };

export type ClockView = {
  whiteMs: number;
  blackMs: number;
  running: Color | null;
  /** The side whose clock ran out, once that has happened. */
  flagged: Color | null;
  initialMs: number;
  incrementMs: number;
};

export type Status = {
  turn: Color;
  check: boolean;
  over: boolean;
  outcome: Outcome | null;
  /** PGN form: `1-0`, `0-1`, `1/2-1/2`, or `*` while the game is live. */
  result: PgnResult;
  fen: string;
  /** Plies played, i.e. `history.length`. */
  ply: number;
  history: Ply[];
  drawOffer: Color | null;
  redoable: number;
};

export type NewGameOptions = {
  fen?: string;
  pgn?: string;
  seed?: number;
  clock?: ClockConfig;
  players?: { white: string; black: string };
  /** Injected wall clock in ms, so tests never sleep. */
  now?: () => number;
};

/** Everything needed to rebuild a session, minus the save-file schema version. */
export type SessionSnapshot = {
  startFen: string;
  players: { white: string; black: string };
  tags: Record<string, string>;
  seed: number;
  /** SAN, in order: replaying these through chess.js is the only restore path. */
  moves: string[];
  /** Declared results only — a checkmate is re-derived from the position. */
  outcome: Outcome | null;
  drawOffer: Color | null;
  clock: { initialMs: number; incrementMs: number; whiteMs: number; blackMs: number } | null;
};

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionError";
  }
}

const DEFAULT_PLAYERS = { white: "tokenmate", black: "tokenmate" };

// The seven tag roster plus the two a FEN start needs; everything else a PGN
// brought with it is passed through untouched.
const MANAGED_TAGS = new Set(["Event", "Site", "Date", "Round", "White", "Black", "Result", "SetUp", "FEN"]);

const SQUARE_SET = new Set<string>(SQUARES);
const PROMOTIONS = new Set<string>(["q", "r", "b", "n"]);

const other = (color: Color): Color => (color === "w" ? "b" : "w");

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const uciOf = (m: { from: string; to: string; promotion?: string }) => m.from + m.to + (m.promotion ?? "");

const resultOf = (outcome: Outcome | null): PgnResult =>
  outcome === null ? "*" : outcome.winner === null ? "1/2-1/2" : outcome.winner === "w" ? "1-0" : "0-1";

const loserOf = (outcome: Outcome): Color | null => (outcome.winner === null ? null : other(outcome.winner));

const toPly = (m: Move, ply: number): Ply => ({
  ply,
  san: m.san,
  uci: uciOf(m),
  fen: m.after,
  from: m.from,
  to: m.to,
  color: m.color,
  piece: m.piece,
  captured: m.captured,
  promotion: m.promotion,
});

const toLegalMove = (m: Move): LegalMove => ({
  san: m.san,
  uci: uciOf(m),
  from: m.from,
  to: m.to,
  color: m.color,
  piece: m.piece,
  captured: m.captured,
  promotion: m.promotion,
  // chess.js 1.4.0 returns false from isCapture() for an en-passant capture even
  // though it reports the taken pawn; measured, not assumed. A model choosing from
  // this list must not see an en passant as a quiet move.
  capture: m.isCapture() || m.isEnPassant(),
  enPassant: m.isEnPassant(),
  castle: m.isKingsideCastle() ? "kingside" : m.isQueensideCastle() ? "queenside" : null,
});

const stripManaged = (headers: Record<string, string>) =>
  Object.fromEntries(Object.entries(headers).filter(([key]) => !MANAGED_TAGS.has(key)));

const rejected = (reason: MoveRejection, detail: string): MoveRejected => ({ ok: false, reason, detail });

type ParsedInput = { ok: true; move: string | { from: string; to: string; promotion?: string } } | MoveRejected;

type ClockState = {
  cfg: ClockConfig;
  ms: { w: number; b: number };
  /** Wall time the running clock was last folded at; `null` while it is stopped. */
  since: number | null;
};

export class Session {
  private chess: Chess;
  private plies: Ply[];
  private redoStack: Ply[];
  private declared: Outcome | null;
  private offer: Color | null;
  private tags: Record<string, string>;
  private sideNames: { white: string; black: string };
  private clockState: ClockState | null;
  private startFen: string;
  private readonly now: () => number;
  readonly seed: number;
  /** Seeded sessions get a reproducible stream; an unseeded one gets seed 0. */
  readonly rng: Rng;

  private constructor(opts: NewGameOptions) {
    this.now = opts.now ?? Date.now;
    this.seed = opts.seed === undefined ? 0 : Math.trunc(opts.seed) >>> 0;
    this.rng = makeRng(this.seed);
    this.chess = new Chess();
    this.plies = [];
    this.redoStack = [];
    this.declared = null;
    this.offer = null;
    this.tags = {};
    this.sideNames = { ...DEFAULT_PLAYERS };
    this.clockState = null;
    this.startFen = DEFAULT_POSITION;
    if (opts.players) this.sideNames = { white: opts.players.white, black: opts.players.black };
    if (opts.clock) this.startClock(opts.clock);
  }

  static newGame(opts: NewGameOptions = {}): Session {
    if (opts.pgn !== undefined && opts.fen !== undefined)
      throw new SessionError("newGame takes a starting FEN or a PGN, not both");
    const session = new Session(opts);
    if (opts.pgn !== undefined) session.importPgn(opts.pgn);
    else if (opts.fen !== undefined) session.loadFen(opts.fen);
    return session;
  }

  /**
   * Parses and replays the whole PGN on a throwaway instance first, so a bad file
   * cannot leave a half-loaded game behind.
   */
  importPgn(pgn: string): void {
    const probe = new Chess();
    try {
      probe.loadPgn(pgn);
    } catch (e) {
      throw new SessionError(`cannot read PGN: ${message(e)}`);
    }
    const headers = probe.getHeaders();
    // chess.js accepts a mis-cased `[Fen]`, so read it the same way.
    const fenTag = Object.entries(headers).find(([key]) => key.toLowerCase() === "fen")?.[1];
    const startFen = fenTag ?? DEFAULT_POSITION;
    const plies = probe.history({ verbose: true }).map(toPly);

    this.chess = probe;
    this.startFen = startFen;
    this.plies = plies;
    this.redoStack = [];
    this.declared = null;
    this.offer = null;
    this.tags = stripManaged(headers);
    this.sideNames = {
      white: headers["White"] ?? DEFAULT_PLAYERS.white,
      black: headers["Black"] ?? DEFAULT_PLAYERS.black,
    };
    this.resetClock();
  }

  /** Starts from a FEN that chess.js validates before anything is replaced. */
  loadFen(fen: string): void {
    const check = validateFen(fen);
    if (!check.ok) throw new SessionError(`cannot read FEN: ${check.error ?? "invalid position"}`);
    const probe = new Chess(fen);
    this.chess = probe;
    this.startFen = probe.fen();
    this.plies = [];
    this.redoStack = [];
    this.declared = null;
    this.offer = null;
    this.tags = {};
    this.resetClock();
  }

  /**
   * The one door a move can come through. Never throws for a bad move: a rejected
   * move is an ordinary event, and its reason is what the TUI puts in the status line.
   */
  move(input: MoveInput): MoveResult {
    this.syncClock();
    const over = this.resolveOutcome();
    if (over) return rejected("game-over", `the game is over (${over.reason})`);

    const turn = this.chess.turn();
    const parsed = this.parseInput(input, turn);
    if (!parsed.ok) return parsed;

    let made: Move;
    try {
      made = this.chess.move(parsed.move);
    } catch (e) {
      return rejected("illegal", message(e));
    }

    const ply = toPly(made, this.plies.length + 1);
    this.plies.push(ply);
    this.redoStack.length = 0;
    this.offer = null;
    if (this.clockState) {
      this.clockState.ms[turn] += this.clockState.cfg.incrementMs;
      this.clockState.since = this.now();
    }
    return { ok: true, result: resultOf(this.resolveOutcome()), ...ply };
  }

  /** Returns the ply taken back, or `null` when there is nothing to take back. */
  undo(): Ply | null {
    this.syncClock();
    // A resignation or an agreement is a result of record, not a position.
    if (this.declared) return null;
    const last = this.plies.pop();
    if (!last) return null;
    this.chess.undo();
    this.redoStack.push(last);
    this.offer = null;
    if (this.clockState) this.clockState.since = this.now();
    return last;
  }

  redo(): Ply | null {
    this.syncClock();
    if (this.declared) return null;
    const next = this.redoStack.pop();
    if (!next) return null;
    try {
      this.chess.move(next.san);
    } catch (e) {
      // A ply we accepted once cannot become illegal; if it does, the stack is
      // corrupt and dropping it is safer than a position that disagrees with history.
      this.redoStack.push(next);
      throw new SessionError(`cannot replay ${next.san}: ${message(e)}`);
    }
    this.plies.push(next);
    if (this.clockState) this.clockState.since = this.now();
    return next;
  }

  /** Undo n plies; returns how many were actually taken back. */
  takeback(n = 1): number {
    const want = Math.max(0, Math.trunc(n));
    let taken = 0;
    while (taken < want && this.undo()) taken++;
    return taken;
  }

  resign(color: Color): boolean {
    if (this.resolveOutcome()) return false;
    this.declared = { reason: "resignation", winner: other(color) };
    this.offer = null;
    return true;
  }

  offerDraw(color: Color): boolean {
    if (this.resolveOutcome()) return false;
    this.offer = color;
    return true;
  }

  acceptDraw(): boolean {
    if (this.resolveOutcome() || this.offer === null) return false;
    this.declared = { reason: "agreed-draw", winner: null };
    this.offer = null;
    return true;
  }

  declineDraw(): void {
    this.offer = null;
  }

  fen(): string {
    return this.chess.fen();
  }

  pgn(): string {
    this.applyHeaders();
    return this.chess.pgn({ maxWidth: 80 });
  }

  status(): Status {
    // Reading the clock is what settles a flag: one place declares the timeout, so a
    // TUI that renders status every frame cannot miss it.
    this.syncClock();
    const outcome = this.resolveOutcome();
    return {
      turn: this.chess.turn(),
      check: this.chess.isCheck(),
      over: outcome !== null,
      outcome,
      result: resultOf(outcome),
      fen: this.chess.fen(),
      ply: this.plies.length,
      history: this.plies.slice(),
      drawOffer: this.offer,
      redoable: this.redoStack.length,
    };
  }

  /** Sorted by UCI, so the list a model sees is identical between calls. */
  legalMoves(): LegalMove[] {
    // Nothing is offered in a finished game — including one that ended by
    // resignation, where the board itself would still generate moves.
    if (this.resolveOutcome()) return [];
    return this.chess
      .moves({ verbose: true })
      .map(toLegalMove)
      .sort((a, b) => (a.uci < b.uci ? -1 : a.uci > b.uci ? 1 : 0));
  }

  clock(): ClockView | null {
    const st = this.clockState;
    if (!st) return null;
    this.syncClock();
    const declared = this.declared;
    const timedOut = declared !== null && declared.reason === "timeout" ? loserOf(declared) : null;
    return {
      whiteMs: st.ms.w,
      blackMs: st.ms.b,
      running: this.declared ? null : this.chess.turn(),
      flagged: timedOut,
      initialMs: st.cfg.initialMs,
      incrementMs: st.cfg.incrementMs,
    };
  }

  get players(): { white: string; black: string } {
    return { ...this.sideNames };
  }

  get drawOffer(): Color | null {
    return this.offer;
  }

  snapshot(): SessionSnapshot {
    const view = this.clock();
    return {
      startFen: this.startFen,
      players: this.players,
      tags: { ...this.tags },
      seed: this.seed,
      moves: this.plies.map((p) => p.san),
      outcome: this.declared ? { ...this.declared } : null,
      drawOffer: this.offer,
      clock: view
        ? {
            initialMs: view.initialMs,
            incrementMs: view.incrementMs,
            whiteMs: view.whiteMs,
            blackMs: view.blackMs,
          }
        : null,
    };
  }

  static fromSnapshot(snap: SessionSnapshot): Session {
    const session = Session.newGame({
      fen: snap.startFen,
      seed: snap.seed,
      players: snap.players,
      clock: snap.clock ? { initialMs: snap.clock.initialMs, incrementMs: snap.clock.incrementMs } : undefined,
    });
    session.tags = { ...snap.tags };
    // The move list is the source of truth: a file whose moves no longer replay is
    // corrupt, and saying so beats resuming into a position that never existed.
    for (const san of snap.moves) {
      const r = session.move(san);
      if (!r.ok) throw new SessionError(`recorded move ${san} is ${r.reason}: ${r.detail}`);
    }
    session.declared = snap.outcome ? { ...snap.outcome } : null;
    session.offer = snap.drawOffer;
    if (session.clockState && snap.clock) {
      session.clockState.ms = { w: snap.clock.whiteMs, b: snap.clock.blackMs };
      // Resuming does not bill the wall time spent away from the app.
      session.clockState.since = null;
    }
    return session;
  }

  /** The result the board or the table declares — no clock reads. */
  private resolveOutcome(): Outcome | null {
    if (this.declared) return this.declared;
    const c = this.chess;
    if (c.isCheckmate()) return { reason: "checkmate", winner: other(c.turn()) };
    if (c.isStalemate()) return { reason: "stalemate", winner: null };
    if (c.isInsufficientMaterial()) return { reason: "insufficient-material", winner: null };
    if (c.isThreefoldRepetition()) return { reason: "threefold-repetition", winner: null };
    if (c.isDrawByFiftyMoves()) return { reason: "fifty-move", winner: null };
    return null;
  }

  // Takes `unknown` on purpose: the move may come from a model, so a shape we did
  // not expect has to come back as a reason, not as a TypeError.
  private parseInput(raw: unknown, turn: Color): ParsedInput {
    if (typeof raw === "string") {
      const san = raw.trim();
      if (san === "") return rejected("bad-input", "empty move");
      return { ok: true, move: san };
    }
    if (raw === null || typeof raw !== "object")
      return rejected("bad-input", "a move is SAN or { from, to, promotion }");

    const { from: rawFrom, to: rawTo, promotion: rawPromotion } = raw as {
      from?: unknown;
      to?: unknown;
      promotion?: unknown;
    };
    if (typeof rawFrom !== "string" || typeof rawTo !== "string")
      return rejected("bad-input", "from and to must be square names");
    const from = rawFrom.toLowerCase();
    const to = rawTo.toLowerCase();
    if (!SQUARE_SET.has(from) || !SQUARE_SET.has(to))
      return rejected("bad-input", `${rawFrom}${rawTo} is not a pair of squares`);

    const piece = this.chess.get(from as Square);
    if (piece && piece.color !== turn)
      return rejected(
        "not-your-turn",
        `${from} holds a ${piece.color === "w" ? "white" : "black"} piece and it is ${turn === "w" ? "white" : "black"} to move`,
      );

    if (rawPromotion === undefined) return { ok: true, move: { from, to } };
    if (typeof rawPromotion !== "string") return rejected("bad-input", "promotion must be a piece letter");
    const promotion = rawPromotion.toLowerCase();
    if (!PROMOTIONS.has(promotion))
      return rejected("bad-input", `promotion must be one of q, r, b, n — not "${rawPromotion}"`);
    return { ok: true, move: { from, to, promotion } };
  }

  // The clock starts when the game starts, not at the first frame that renders it:
  // a session created and then left alone still loses its time.
  private startClock(cfg: ClockConfig): void {
    const initialMs = Math.max(0, Math.trunc(cfg.initialMs));
    const incrementMs = Math.max(0, Math.trunc(cfg.incrementMs));
    this.clockState = {
      cfg: { initialMs, incrementMs },
      ms: { w: initialMs, b: initialMs },
      since: this.now(),
    };
  }

  private resetClock(): void {
    const st = this.clockState;
    if (!st) return;
    st.ms = { w: st.cfg.initialMs, b: st.cfg.initialMs };
    st.since = this.now();
  }

  private syncClock(): void {
    const st = this.clockState;
    if (!st) return;
    if (this.resolveOutcome()) {
      st.since = null;
      return;
    }
    const side = this.chess.turn();
    const now = this.now();
    if (st.since !== null) st.ms[side] = Math.max(0, st.ms[side] - Math.max(0, now - st.since));
    st.since = now;
    if (st.ms[side] <= 0) this.declared = { reason: "timeout", winner: other(side) };
  }

  private applyHeaders(): void {
    const c = this.chess;
    for (const [key, value] of Object.entries(this.tags)) c.setHeader(key, value);
    c.setHeader("White", this.sideNames.white);
    c.setHeader("Black", this.sideNames.black);
    c.setHeader("Result", resultOf(this.resolveOutcome()));
    if (this.startFen === DEFAULT_POSITION) {
      c.removeHeader("SetUp");
      c.removeHeader("FEN");
    } else {
      c.setHeader("SetUp", "1");
      c.setHeader("FEN", this.startFen);
    }
  }
}

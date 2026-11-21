import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clear, lastGamePath, load, save } from "../src/game/resume";
import { Session, type MoveAccepted, type MoveRejected, type MoveResult } from "../src/game/session";
import { hashSeed, makeRng, randomSeed } from "../src/util/rng";

const accepted = (r: MoveResult): MoveAccepted => {
  if (!r.ok) throw new Error(`expected a legal move, got ${r.reason}: ${r.detail}`);
  return r;
};

const refused = (r: MoveResult): MoveRejected => {
  if (r.ok) throw new Error(`expected a rejection, got ${r.san}`);
  return r;
};

const play = (s: Session, moves: string[]): Session => {
  for (const move of moves) accepted(s.move(move));
  return s;
};

const sans = (s: Session) => s.status().history.map((p) => p.san);

const movetext = (pgn: string) =>
  pgn
    .split("\n")
    .filter((line) => !line.startsWith("["))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

const draws = (seed: number, n = 8) => {
  const rng = makeRng(seed);
  return Array.from({ length: n }, () => rng.next());
};

describe("rng", () => {
  test("the same seed produces the same sequence", () => {
    expect(draws(20260101)).toEqual(draws(20260101));
  });

  test("a different seed produces a different sequence", () => {
    expect(draws(1)).not.toEqual(draws(2));
  });

  test("two streams from one seed never share state", () => {
    const a = makeRng(9);
    const b = makeRng(9);
    a.next();
    a.next();
    expect(b.next()).toBe(draws(9, 1)[0]!);
  });

  test("int stays in range and covers the range", () => {
    const rng = makeRng(7);
    const picked = Array.from({ length: 200 }, () => rng.int(6));
    expect(picked.every((n) => Number.isInteger(n) && n >= 0 && n < 6)).toBe(true);
    expect(new Set(picked).size).toBe(6);
  });

  test("pick only returns members, and refuses an empty list", () => {
    const rng = makeRng(3);
    const picked = Array.from({ length: 50 }, () => rng.pick(["a", "b", "c"]));
    expect(picked.every((p) => p === "a" || p === "b" || p === "c")).toBe(true);
    expect(() => rng.pick([])).toThrow(/empty/);
  });

  test("shuffle is a deterministic permutation that leaves the input untouched", () => {
    const items = ["a", "b", "c", "d", "e"];
    const out = makeRng(11).shuffle(items);
    expect(items).toEqual(["a", "b", "c", "d", "e"]);
    expect([...out].sort()).toEqual([...items].sort());
    expect(makeRng(11).shuffle(items)).toEqual(out);
  });

  test("hashSeed and randomSeed stay inside uint32", () => {
    expect(hashSeed("blackmar")).toBe(hashSeed("blackmar"));
    expect(hashSeed("blackmar")).not.toBe(hashSeed("blackmars"));
    for (const n of [hashSeed("x"), randomSeed()]) expect(Number.isInteger(n) && n >= 0 && n < 2 ** 32).toBe(true);
  });
});

describe("session: chess.js is the legality gate", () => {
  test("an illegal move is refused and leaves no trace", () => {
    const s = Session.newGame();
    const before = s.fen();
    const r = refused(s.move({ from: "e2", to: "e5" }));
    expect(r.reason).toBe("illegal");
    expect(s.status().ply).toBe(0);
    expect(s.status().history).toEqual([]);
    expect(s.fen()).toBe(before);
    expect(movetext(s.pgn())).toBe("*");
  });

  test("a move by the side that is not to move says so", () => {
    const s = Session.newGame();
    accepted(s.move("e4"));
    const r = refused(s.move({ from: "d2", to: "d3" }));
    expect(r.reason).toBe("not-your-turn");
    expect(s.status().history.length).toBe(1);
  });

  test("nonsense input is rejected without throwing", () => {
    const s = Session.newGame();
    expect(refused(s.move({ from: "e9", to: "e4" })).reason).toBe("bad-input");
    expect(refused(s.move("   ")).reason).toBe("bad-input");
    expect(refused(s.move("Qd8")).reason).toBe("illegal");
    expect(s.status().history).toEqual([]);
  });

  test("the legal move list is exact", () => {
    const s = Session.newGame();
    const moves = s.legalMoves();
    expect(moves.map((m) => m.uci)).toEqual([
      "a2a3",
      "a2a4",
      "b1a3",
      "b1c3",
      "b2b3",
      "b2b4",
      "c2c3",
      "c2c4",
      "d2d3",
      "d2d4",
      "e2e3",
      "e2e4",
      "f2f3",
      "f2f4",
      "g1f3",
      "g1h3",
      "g2g3",
      "g2g4",
      "h2h3",
      "h2h4",
    ]);
    expect(moves.find((m) => m.uci === "e2e4")?.san).toBe("e4");
    expect(moves.find((m) => m.uci === "g1f3")?.san).toBe("Nf3");
    expect(moves.every((m) => m.color === "w" && !m.capture)).toBe(true);
  });

  test("a promotion must be named, and the list offers all four pieces", () => {
    const s = Session.newGame({ fen: "2n1k3/1P6/8/8/8/8/8/4K3 w - - 0 1" });
    const promotions = s.legalMoves()
      .filter((m) => m.promotion !== undefined)
      .map((m) => m.uci);
    expect(promotions).toEqual(["b7b8b", "b7b8n", "b7b8q", "b7b8r", "b7c8b", "b7c8n", "b7c8q", "b7c8r"]);
    expect(refused(s.move({ from: "b7", to: "b8" })).reason).toBe("illegal");
    expect(refused(s.move({ from: "b7", to: "b8", promotion: "k" })).reason).toBe("bad-input");
    expect(accepted(s.move({ from: "b7", to: "b8", promotion: "q" })).san).toBe("b8=Q");
  });

  test("castling and en passant carry their flag", () => {
    const castle = Session.newGame({ fen: "4k3/8/8/8/8/8/8/4K2R w K - 0 1" });
    expect(castle.legalMoves().find((m) => m.san === "O-O")?.castle).toBe("kingside");

    const ep = Session.newGame({ fen: "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2" });
    const capture = ep.legalMoves().find((m) => m.uci === "e5d6");
    expect(capture?.enPassant).toBe(true);
    expect(capture?.capture).toBe(true);
    expect(capture?.captured).toBe("p");
  });

  test("a checkmate ends the game and refuses further moves", () => {
    const s = play(Session.newGame(), ["f3", "e5", "g4", "Qh4#"]);
    const st = s.status();
    expect(st.check).toBe(true);
    expect(st.over).toBe(true);
    expect(st.outcome).toEqual({ reason: "checkmate", winner: "b" });
    expect(st.result).toBe("0-1");
    expect(s.legalMoves()).toEqual([]);
    expect(refused(s.move({ from: "e1", to: "f2" })).reason).toBe("game-over");
    expect(s.status().history.length).toBe(4);
  });

  test("resignation and an agreed draw are results of record", () => {
    const a = Session.newGame();
    expect(a.resign("w")).toBe(true);
    expect(a.status().outcome).toEqual({ reason: "resignation", winner: "b" });
    expect(a.status().result).toBe("0-1");
    expect(a.resign("b")).toBe(false);
    expect(a.undo()).toBeNull();

    const b = Session.newGame();
    expect(b.acceptDraw()).toBe(false);
    expect(b.offerDraw("w")).toBe(true);
    expect(b.drawOffer).toBe("w");
    expect(b.acceptDraw()).toBe(true);
    expect(b.status().outcome).toEqual({ reason: "agreed-draw", winner: null });
    expect(b.status().result).toBe("1/2-1/2");
    expect(b.pgn()).toContain('[Result "1/2-1/2"]');
  });

  test("the PGN carries the seven tag roster", () => {
    const s = play(Session.newGame({ players: { white: "you", black: "stockfish-8" } }), ["f3", "e5", "g4", "Qh4#"]);
    const text = s.pgn();
    for (const tag of ["Event", "Site", "Date", "Round", "White", "Black", "Result"]) expect(text).toContain(`[${tag} "`);
    expect(text).toContain('[White "you"]');
    expect(text).toContain('[Black "stockfish-8"]');
    expect(text).toContain('[Result "0-1"]');
  });
});

describe("session: undo, redo and takeback", () => {
  test("undo restores the previous FEN and redo puts it back", () => {
    const s = play(Session.newGame(), ["e4", "e5", "Nf3"]);
    const fens = s.status().history.map((p) => p.fen);
    const atThree = s.fen();
    expect(s.undo()?.san).toBe("Nf3");
    expect(s.fen()).toBe(fens[1]!);
    expect(s.status().redoable).toBe(1);
    expect(s.redo()?.san).toBe("Nf3");
    expect(s.fen()).toBe(atThree);
    expect(sans(s)).toEqual(["e4", "e5", "Nf3"]);
    expect(s.redo()).toBeNull();
  });

  test("a new move drops the redo stack", () => {
    const s = play(Session.newGame(), ["e4", "e5"]);
    s.undo();
    accepted(s.move("c5"));
    expect(s.redo()).toBeNull();
    expect(s.status().redoable).toBe(0);
    expect(sans(s)).toEqual(["e4", "c5"]);
  });

  test("takeback counts plies and stops at the start", () => {
    const s = play(Session.newGame(), ["e4", "e5", "Nf3", "Nc6"]);
    const fens = s.status().history.map((p) => p.fen);
    expect(s.takeback(2)).toBe(2);
    expect(s.fen()).toBe(fens[1]!);
    expect(sans(s)).toEqual(["e4", "e5"]);
    expect(s.takeback(10)).toBe(2);
    expect(s.status().ply).toBe(0);
    expect(s.takeback(1)).toBe(0);
  });

  test("undo reopens a game that ended on the board", () => {
    const s = play(Session.newGame(), ["f3", "e5", "g4", "Qh4#"]);
    expect(s.status().over).toBe(true);
    expect(s.undo()?.san).toBe("Qh4#");
    expect(s.status().over).toBe(false);
    expect(s.status().result).toBe("*");
  });
});

describe("session: draws", () => {
  test("stalemate is a draw, not a win", () => {
    const s = Session.newGame({ fen: "k7/8/1Q6/8/8/8/8/7K b - - 0 1" });
    const st = s.status();
    expect(st.check).toBe(false);
    expect(st.outcome).toEqual({ reason: "stalemate", winner: null });
    expect(st.result).toBe("1/2-1/2");
  });

  test("insufficient material", () => {
    const s = Session.newGame({ fen: "k7/8/8/8/8/8/8/K6B w - - 0 1" });
    expect(s.status().outcome).toEqual({ reason: "insufficient-material", winner: null });
    expect(s.status().result).toBe("1/2-1/2");
  });

  test("threefold repetition", () => {
    const s = play(Session.newGame(), ["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8"]);
    expect(s.status().outcome).toEqual({ reason: "threefold-repetition", winner: null });
    expect(s.status().result).toBe("1/2-1/2");
    expect(refused(s.move("e4")).reason).toBe("game-over");
  });

  test("fifty moves without a pawn push or a capture", () => {
    const s = Session.newGame({ fen: "4k3/8/8/8/8/8/8/4K2R w - - 99 60" });
    expect(s.status().over).toBe(false);
    accepted(s.move({ from: "h1", to: "h2" }));
    expect(s.status().outcome).toEqual({ reason: "fifty-move", winner: null });
    expect(s.status().result).toBe("1/2-1/2");
  });
});

// 1.e4 h6 2.e5 d5 3.exd6 h5 4.Nf3 g6 5.Be2 g5 6.O-O Nc6 7.a4 b6 8.a5 Nf6
// 9.axb6 Qd7 10.b7 Bg7 11.b8=Q — one game, one en passant capture, one castle,
// one promotion.
const FULL_HOUSE = [
  "e4",
  "h6",
  "e5",
  "d5",
  "exd6",
  "h5",
  "Nf3",
  "g6",
  "Be2",
  "g5",
  "O-O",
  "Nc6",
  "a4",
  "b6",
  "a5",
  "Nf6",
  "axb6",
  "Qd7",
  "b7",
  "Bg7",
  "b8=Q",
];

describe("session: PGN", () => {
  test("castling, en passant and promotion survive export and import", () => {
    const s = play(Session.newGame(), FULL_HOUSE);
    const text = s.pgn();
    expect(text).toContain("O-O");
    expect(text).toContain("exd6");
    expect(text).toContain("b8=Q");

    const back = Session.newGame({ pgn: text });
    expect(back.fen()).toBe(s.fen());
    expect(sans(back)).toEqual(sans(s));
    expect(back.status().history.map((p) => p.fen)).toEqual(s.status().history.map((p) => p.fen));
    expect(movetext(back.pgn())).toBe(movetext(text));
    expect(back.legalMoves()).toEqual(s.legalMoves());
  });

  test("a game from a FEN keeps its SetUp and FEN headers", () => {
    const fen = "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1";
    const s = play(Session.newGame({ fen }), ["e4", "Kd8"]);
    const text = s.pgn();
    expect(text).toContain('[SetUp "1"]');
    expect(text).toContain(`[FEN "${fen}"]`);

    const back = Session.newGame({ pgn: text });
    expect(back.fen()).toBe(s.fen());
    expect(sans(back)).toEqual(["e4", "Kd8"]);
    expect(back.pgn()).toContain(`[FEN "${fen}"]`);
  });

  test("a PGN that cannot be replayed leaves the game alone", () => {
    const s = play(Session.newGame(), ["e4"]);
    const before = s.fen();
    expect(() => s.importPgn("1. Nf3 Nf3 *")).toThrow(/PGN/);
    expect(s.fen()).toBe(before);
    expect(sans(s)).toEqual(["e4"]);
    expect(() => Session.newGame({ pgn: "not a game at all" })).toThrow(/PGN/);
  });

  test("a FEN is validated, then copied back exactly", () => {
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";
    const s = Session.newGame({ fen });
    expect(s.fen()).toBe(fen);
    expect(s.status().turn).toBe("w");
    expect(() => Session.newGame({ fen: "8/8/8/8/8/8/8/8 w - - 0 1" })).toThrow(/FEN/);
    expect(() => Session.newGame({ fen, pgn: "1. e4 *" })).toThrow(/not both/);
  });
});

describe("session: clock", () => {
  test("there is no clock unless one was asked for", () => {
    expect(Session.newGame().clock()).toBeNull();
  });

  test("time runs down and increments are added", () => {
    let now = 0;
    const s = Session.newGame({ clock: { initialMs: 60_000, incrementMs: 1_000 }, now: () => now });
    now = 5_000;
    const ticking = s.clock()!;
    expect(ticking.whiteMs).toBe(55_000);
    expect(ticking.blackMs).toBe(60_000);
    expect(ticking.running).toBe("w");
    expect(ticking.flagged).toBeNull();

    accepted(s.move("e4"));
    const afterMove = s.clock()!;
    expect(afterMove.whiteMs).toBe(56_000);
    expect(afterMove.blackMs).toBe(60_000);
    expect(afterMove.running).toBe("b");

    now = 9_000;
    const later = s.clock()!;
    expect(later.blackMs).toBe(56_000);
    expect(later.whiteMs).toBe(56_000);
  });

  test("a flag ends the game and refuses the move", () => {
    let now = 0;
    const s = Session.newGame({ clock: { initialMs: 1_000, incrementMs: 0 }, now: () => now });
    now = 1_000;
    const flagged = s.clock()!;
    expect(flagged.whiteMs).toBe(0);
    expect(flagged.flagged).toBe("w");
    expect(flagged.running).toBeNull();
    expect(s.status().outcome).toEqual({ reason: "timeout", winner: "b" });
    expect(s.status().result).toBe("0-1");
    expect(refused(s.move("e4")).reason).toBe("game-over");
  });

  test("a stopped clock does not drift", () => {
    let now = 0;
    const s = Session.newGame({ clock: { initialMs: 1_000, incrementMs: 0 }, now: () => now });
    now = 500;
    expect(s.clock()!.whiteMs).toBe(500);
    expect(s.resign("w")).toBe(true);
    now = 10_000;
    expect(s.clock()!.whiteMs).toBe(500);
    expect(s.clock()!.running).toBeNull();
  });
});

describe("resume", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tokenmate-resume-"));
    process.env["TOKENMATE_HOME"] = dir;
  });

  afterEach(() => {
    delete process.env["TOKENMATE_HOME"];
    rmSync(dir, { recursive: true, force: true });
  });

  test("save then load keeps the position, the moves, the players, the seed and the clock", () => {
    const s = Session.newGame({
      seed: 42,
      clock: { initialMs: 300_000, incrementMs: 3_000 },
      players: { white: "you", black: "stockfish-8" },
      now: () => 1_000_000,
    });
    play(s, ["e4", "e5", "Nf3"]);
    const saved = s.snapshot();
    const path = save(s);
    expect(path).toBe(lastGamePath());
    expect(path.startsWith(dir)).toBe(true);
    expect(readFileSync(path, "utf8")).toContain('"version": 1');

    const back = load();
    expect(back.fen()).toBe(s.fen());
    expect(sans(back)).toEqual(["e4", "e5", "Nf3"]);
    expect(back.players).toEqual({ white: "you", black: "stockfish-8" });
    expect(back.seed).toBe(42);
    expect(back.rng.next()).toBe(makeRng(42).next());

    const before = saved.clock!;
    const after = back.clock()!;
    expect(after.whiteMs).toBe(before.whiteMs);
    expect(after.blackMs).toBe(before.blackMs);
    expect(after.incrementMs).toBe(3_000);
    expect(after.running).toBe("b");
  });

  test("a declared result survives the round trip", () => {
    const s = play(Session.newGame(), ["e4", "e5"]);
    expect(s.resign("b")).toBe(true);
    save(s);
    const back = load();
    expect(back.status().outcome).toEqual({ reason: "resignation", winner: "w" });
    expect(back.status().result).toBe("1-0");
  });

  test("corrupt, foreign and unreplayable files are refused with a reason", () => {
    const path = lastGamePath();
    const game = {
      startFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      players: { white: "a", black: "b" },
      tags: {},
      seed: 0,
      moves: [] as string[],
      outcome: null,
      drawOffer: null,
      clock: null,
    };

    writeFileSync(path, "{ not json");
    expect(() => load()).toThrow(/not valid JSON/);

    writeFileSync(path, JSON.stringify({ version: 99, savedAt: "x", game }));
    expect(() => load()).toThrow(/version 99/);

    writeFileSync(path, JSON.stringify({ savedAt: "x", game }));
    expect(() => load()).toThrow(/no save version/);

    writeFileSync(path, JSON.stringify({ version: 1, savedAt: "x", game: {} }));
    expect(() => load()).toThrow(/not a valid save file/);

    writeFileSync(path, JSON.stringify({ version: 1, savedAt: "x", game: { ...game, moves: ["e4", "e4"] } }));
    expect(() => load()).toThrow(/recorded move/);

    writeFileSync(path, JSON.stringify({ version: 1, savedAt: "x", game: { ...game, startFen: "8/8/8/8/8/8/8/8 w - - 0 1" } }));
    expect(() => load()).toThrow(/cannot be resumed/);

    expect(() => load(join(dir, "nothing-here.json"))).toThrow(/no saved game/);
  });

  test("clear drops the saved game", () => {
    save(play(Session.newGame(), ["e4"]));
    expect(clear()).toBe(true);
    expect(() => load()).toThrow(/no saved game/);
    expect(clear()).toBe(false);
  });
});

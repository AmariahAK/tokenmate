import { describe, expect, test } from "bun:test";
import { BUILTIN_CAP, builtinDepth, builtinSettings } from "../src/builtin/index";
import { Position, moveToUci } from "../src/builtin/position";
import { MATE, searchRoot, type SearchResult } from "../src/builtin/search";

// Perft: the count of legal move sequences from a position. These six positions are
// the standard suite (startpos, Kiwipete and the four others from the Chess
// Programming Wiki). A movegen bug changes a count, so this is the test that says
// the engine plays chess rather than something adjacent to it.
const CASES: [string, string][] = [
  ["startpos", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"],
  ["kiwipete", "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1"],
  ["position 3", "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1"],
  ["position 4", "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1"],
  ["position 5", "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 0 1"],
  ["position 6", "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 1"],
];

const EXPECTED: Record<string, number[]> = {
  startpos: [20, 400, 8902, 197281],
  kiwipete: [48, 2039, 97862],
  "position 3": [14, 191, 2812, 43238],
  "position 4": [6, 264, 9467],
  "position 5": [44, 1486, 62379],
  "position 6": [46, 2079, 89890],
};

describe("built-in movegen: perft", () => {
  for (const [name, fen] of CASES) {
    const expected = EXPECTED[name] ?? [];
    test(`${name} reaches the published counts`, () => {
      const pos = Position.fromFen(fen);
      const got = expected.map((_, i) => pos.perft(i + 1));
      expect(got).toEqual(expected);
    });
  }

  test("perft leaves the position exactly as it found it", () => {
    // make/unmake is where an engine silently rots: a leaked castling right or a
    // stale king square still passes perft once and fails later.
    const pos = Position.fromFen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1");
    const before = pos.fen();
    pos.perft(3);
    expect(pos.fen()).toBe(before);
  });
});

describe("built-in engine: it plays", () => {
  const bestAt = (fen: string, maxDepth: number): SearchResult[] =>
    searchRoot(Position.fromFen(fen), { maxDepth, movetime: 4000, multiPv: 1 });

  test("finds mate in one and reports it as mate", () => {
    // Ra8#: the king is boxed in by its own pawns on g7/h7 and the eighth rank.
    const [top] = bestAt("7k/6pp/8/8/8/8/8/R6K w - - 0 1", 3);
    expect(top).toBeDefined();
    expect(moveToUci(top!.move)).toBe("a1a8");
    expect(top!.score).toBeGreaterThan(MATE - 100);
  });

  test("takes a hanging queen", () => {
    const [top] = bestAt("4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1", 3);
    expect(moveToUci(top!.move)).toBe("e4d5");
  });

  test("never returns an illegal move, from any of the perft positions", () => {
    for (const [, fen] of CASES) {
      const pos = Position.fromFen(fen);
      const legal = new Set(pos.generateLegal().map(moveToUci));
      for (const result of searchRoot(pos, { maxDepth: 2, movetime: 2000, multiPv: 4 })) {
        expect(legal.has(moveToUci(result.move))).toBe(true);
      }
    }
  });

  test("is deterministic: the same position gives the same move twice", () => {
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 3";
    expect(bestAt(fen, 3)[0]?.move).toBe(bestAt(fen, 3)[0]?.move);
  });

  test("a sampling level offers several candidates, ranked best-first", () => {
    const pos = Position.fromFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    const results = searchRoot(pos, { maxDepth: 3, movetime: 4000, multiPv: 8 });
    expect(results.length).toBe(8);
    const scores = results.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });
});

describe("built-in engine: level mapping stays honest", () => {
  test("depth rises with level and never drops", () => {
    let last = 0;
    for (let level = 1; level <= 20; level++) {
      const depth = builtinDepth(level);
      expect(depth).toBeGreaterThanOrEqual(last);
      last = depth;
    }
  });

  test("a level asking for more than the built-in can reach says so", () => {
    expect(builtinSettings(4).note).toContain("built-in");
    expect(builtinSettings(20).note).toContain("install a UCI engine");
    // and it never claims the level's target when it cannot play it
    expect(builtinSettings(20).elo).toBeLessThanOrEqual(BUILTIN_CAP);
  });

  test("no note claims a measurement it does not have", () => {
    for (let level = 1; level <= 20; level++) {
      expect(builtinSettings(level).note).toContain("estimate");
    }
  });

  test("a sampling level asks for more than one candidate", () => {
    const go = builtinSettings(3).go;
    expect(typeof go.multiPv).toBe("number");
    expect(go.multiPv).toBeGreaterThan(1);
  });
});

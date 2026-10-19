import { describe, expect, test } from "bun:test";
import { Game } from "../src/game/game.ts";

function play(game: Game, moves: [string, string][]) {
  for (const [from, to] of moves) {
    expect(game.move(from as never, to as never)).not.toBeNull();
  }
}

describe("Game", () => {
  test("starts with white to move and 20 legal moves", () => {
    const game = new Game();
    expect(game.turn()).toBe("w");
    expect(game.legalMoves()).toHaveLength(20);
    expect(game.status()).toEqual({ kind: "playing" });
  });

  test("lists legal targets for a square", () => {
    const game = new Game();
    expect(game.legalTargets("e2").sort()).toEqual(["e3", "e4"]);
    expect(game.legalTargets("g1").sort()).toEqual(["f3", "h3"]);
    expect(game.legalTargets("e1")).toEqual([]);
  });

  test("applies a legal move and records SAN", () => {
    const game = new Game();
    const record = game.move("e2", "e4");
    expect(record).toEqual({ from: "e2", to: "e4", san: "e4", color: "w" });
    expect(game.turn()).toBe("b");
    expect(game.history()).toEqual(["e4"]);
    expect(game.lastMove()?.to).toBe("e4");
  });

  test("rejects illegal moves without changing the position", () => {
    const game = new Game();
    const fen = game.fen();
    expect(game.move("e2", "e5")).toBeNull();
    expect(game.move("e7", "e5")).toBeNull();
    expect(game.fen()).toBe(fen);
  });

  test("detects check", () => {
    const game = new Game();
    play(game, [
      ["e2", "e4"],
      ["f7", "f6"],
      ["d1", "h5"],
    ]);
    expect(game.status()).toEqual({ kind: "check" });
  });

  test("detects checkmate and blocks further moves", () => {
    const game = new Game();
    play(game, [
      ["e2", "e4"],
      ["e7", "e5"],
      ["f1", "c4"],
      ["b8", "c6"],
      ["d1", "h5"],
      ["g8", "f6"],
      ["h5", "f7"],
    ]);
    expect(game.status()).toEqual({ kind: "checkmate", winner: "w" });
    expect(game.isOver()).toBe(true);
    expect(game.move("a7", "a6")).toBeNull();
  });

  test("detects stalemate", () => {
    const game = new Game("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
    expect(game.status()).toEqual({ kind: "draw", reason: "stalemate" });
  });

  test("detects insufficient material", () => {
    const game = new Game("8/8/4k3/8/8/4K3/8/8 w - - 0 1");
    expect(game.status()).toEqual({ kind: "draw", reason: "insufficient material" });
  });

  test("detects threefold repetition", () => {
    const game = new Game();
    const shuffle: [string, string][] = [
      ["g1", "f3"],
      ["g8", "f6"],
      ["f3", "g1"],
      ["f6", "g8"],
    ];
    play(game, [...shuffle, ...shuffle]);
    expect(game.status()).toEqual({ kind: "draw", reason: "threefold repetition" });
  });

  test("detects the fifty-move rule", () => {
    const game = new Game("8/8/4k3/8/8/4K3/4R3/8 w - - 100 80");
    expect(game.status()).toEqual({ kind: "draw", reason: "fifty-move rule" });
  });

  test("requires and applies promotion", () => {
    const game = new Game("8/4P3/8/8/8/8/k7/4K3 w - - 0 1");
    expect(game.needsPromotion("e7", "e8")).toBe(true);
    expect(game.needsPromotion("e1", "d1")).toBe(false);
    const record = game.move("e7", "e8", "n");
    expect(record?.san).toBe("e8=N");
    expect(game.pieceAt("e8")).toEqual({ color: "w", type: "n" });
  });

  test("undo restores the previous position", () => {
    const game = new Game();
    const start = game.fen();
    game.move("e2", "e4");
    expect(game.undo()?.san).toBe("e4");
    expect(game.fen()).toBe(start);
    expect(game.undo()).toBeNull();
  });

  test("reset returns to the starting position", () => {
    const game = new Game();
    play(game, [
      ["d2", "d4"],
      ["d7", "d5"],
    ]);
    game.reset();
    expect(game.history()).toEqual([]);
    expect(game.turn()).toBe("w");
  });

  test("exports FEN and PGN", () => {
    const game = new Game();
    play(game, [
      ["e2", "e4"],
      ["c7", "c5"],
    ]);
    expect(game.fen()).toBe("rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2");
    expect(game.pgn()).toContain("1. e4 c5");
  });

  test("snapshot reflects the current position", () => {
    const game = new Game();
    game.move("e2", "e4");
    const snap = game.snapshot();
    expect(snap.turn).toBe("b");
    expect(snap.history).toEqual(["e4"]);
    expect(snap.lastMove?.from).toBe("e2");
    expect(snap.board[4]?.[4]).toEqual({ color: "w", type: "p" });
    expect(snap.board[6]?.[4]).toBeNull();
  });
});

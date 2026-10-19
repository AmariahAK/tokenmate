import { describe, expect, test } from "bun:test";
import { Chess } from "chess.js";
import { BOT_LEVELS, chooseMove } from "../src/engine/bot.ts";
import { Game } from "../src/game/game.ts";
import { BotPlayer } from "../src/game/player.ts";

const noBlunder = () => 0.99;

describe("chooseMove", () => {
  test("finds mate in one at medium and hard", () => {
    const fen = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
    for (const level of ["medium", "hard"] as const) {
      expect(chooseMove(fen, level, noBlunder)).toEqual({ from: "h5", to: "f7" });
    }
  });

  test("takes a hanging queen at every level when not blundering", () => {
    const fen = "rnb1kbnr/pppp1ppp/8/4p3/3qP3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 1";
    for (const level of BOT_LEVELS) {
      expect(chooseMove(fen, level, noBlunder)).toEqual({ from: "f3", to: "d4" });
    }
  });

  test("avoids a move that walks into mate at hard", () => {
    const fen = "6k1/5ppp/8/8/8/8/5PPP/3R2K1 b - - 0 1";
    const move = chooseMove(fen, "hard", noBlunder);
    const chess = new Chess(fen);
    chess.move(move);
    expect(chess.moves({ verbose: true }).some((m) => m.san.endsWith("#"))).toBe(false);
  });

  test("promotes when it is the best move", () => {
    const move = chooseMove("8/P7/8/8/8/8/k7/4K3 w - - 0 1", "medium", noBlunder);
    expect(move).toEqual({ from: "a7", to: "a8", promotion: "q" });
  });

  test("always returns a legal move", () => {
    const chess = new Chess();
    for (let ply = 0; ply < 30 && !chess.isGameOver(); ply++) {
      const move = chooseMove(chess.fen(), "easy");
      expect(() => chess.move(move)).not.toThrow();
    }
  });

  test("throws when there are no legal moves", () => {
    expect(() => chooseMove("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", "easy")).toThrow();
  });
});

describe("BotPlayer", () => {
  test("returns a legal move from the worker", async () => {
    const game = new Game();
    const bot = new BotPlayer("easy", 0);
    expect(bot.kind).toBe("bot");
    expect(bot.name).toBe("Bot (easy)");
    const move = await bot.requestMove(game);
    expect(game.move(move.from, move.to, move.promotion)).not.toBeNull();
  });

  test("rejects when aborted", async () => {
    const controller = new AbortController();
    const request = new BotPlayer("hard", 0).requestMove(new Game(), controller.signal);
    controller.abort();
    await expect(request).rejects.toBeDefined();
  });
});

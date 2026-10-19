import { describe, expect, test } from "bun:test";
import { Game } from "../src/game/game.ts";
import { HumanPlayer } from "../src/game/player.ts";

describe("HumanPlayer", () => {
  test("resolves the pending request with the submitted move", async () => {
    const player = new HumanPlayer("White");
    expect(player.submit({ from: "e2", to: "e4" })).toBe(false);
    const request = player.requestMove(new Game());
    expect(player.isWaiting()).toBe(true);
    expect(player.submit({ from: "e2", to: "e4" })).toBe(true);
    expect(await request).toEqual({ from: "e2", to: "e4" });
    expect(player.isWaiting()).toBe(false);
  });

  test("rejects and stops waiting when aborted", async () => {
    const player = new HumanPlayer("White");
    const controller = new AbortController();
    const request = player.requestMove(new Game(), controller.signal);
    controller.abort();
    await expect(request).rejects.toBeDefined();
    expect(player.isWaiting()).toBe(false);
    expect(player.submit({ from: "e2", to: "e4" })).toBe(false);
  });
});

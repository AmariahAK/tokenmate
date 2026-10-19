import { afterEach, describe, expect, test } from "bun:test";
import type { ScrollBoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { Chess } from "chess.js";
import { Game } from "../src/game/game.ts";
import { createLineup } from "../src/game/setup.ts";
import { canDrawArt, cellWidthFor, fitCellHeight } from "../src/ui/board.tsx";
import { moveRows, Sidebar } from "../src/ui/sidebar.tsx";

let dispose: (() => Promise<void>) | null = null;

afterEach(async () => {
  await dispose?.();
  dispose = null;
});

describe("fitCellHeight", () => {
  test("grows the board with the terminal", () => {
    expect(fitCellHeight(60, 24)).toBe(1);
    expect(fitCellHeight(80, 30)).toBe(2);
    expect(fitCellHeight(120, 32)).toBe(3);
    expect(fitCellHeight(140, 40)).toBe(4);
    expect(fitCellHeight(200, 60)).toBe(5);
  });

  test("is limited by width as well as height", () => {
    expect(fitCellHeight(90, 60)).toBe(2);
  });

  test("keeps squares roughly square and only draws art when there is room", () => {
    expect(cellWidthFor(3)).toBe(7);
    expect(canDrawArt(2)).toBe(false);
    expect(canDrawArt(3)).toBe(true);
  });
});

describe("createLineup", () => {
  test("local games are two humans", () => {
    const { players, humanColor } = createLineup({ mode: "local", level: "easy", color: "b" });
    expect(players.w.kind).toBe("human");
    expect(players.b.kind).toBe("human");
    expect(humanColor).toBe("w");
  });

  test("bot games seat the human on the chosen or random color", () => {
    const black = createLineup({ mode: "bot", level: "hard", color: "b" });
    expect(black.humanColor).toBe("b");
    expect(black.players.w.kind).toBe("bot");
    expect(black.players.w.name).toBe("Bot (hard)");
    expect(
      createLineup({ mode: "bot", level: "easy", color: "random" }, () => 0.1).humanColor,
    ).toBe("w");
    expect(
      createLineup({ mode: "bot", level: "easy", color: "random" }, () => 0.9).humanColor,
    ).toBe("b");
  });
});

describe("move list", () => {
  test("follows the latest move and scrolls back to the first", async () => {
    const chess = new Chess();
    for (let i = 0; i < 60 && !chess.isGameOver(); i++) {
      const moves = chess.moves();
      chess.move(moves[i % moves.length] as string);
    }
    const game = new Game(chess.fen());
    const snapshot = { ...game.snapshot(), history: chess.history() };
    const rows = moveRows(snapshot.history);
    let scrollbox: ScrollBoxRenderable | undefined;

    const s = await testRender(
      () => (
        <box width="100%" height="100%" flexDirection="row">
          <box flexDirection="column">
            <Sidebar
              snapshot={snapshot}
              message={null}
              thinking={null}
              playerNames={{ w: "White", b: "Black" }}
              movesRef={(el) => {
                scrollbox = el;
              }}
            />
          </box>
        </box>
      ),
      { width: 40, height: 30 },
    );
    dispose = s.dispose;
    await s.renderOnce();
    await s.renderOnce();
    const latest = s.captureCharFrame();
    expect(latest).toContain(rows.at(-1) as string);
    expect(latest).not.toContain(rows[0] as string);
    expect(latest).toContain("arrows/hjkl");

    scrollbox?.scrollBy(-rows.length);
    await s.renderOnce();
    expect(s.captureCharFrame()).toContain(rows[0] as string);
  });
});

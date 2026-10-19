import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { App } from "../src/app.tsx";
import type { GameSetup } from "../src/game/setup.ts";
import { GameScreen } from "../src/ui/game-screen.tsx";

type Setup = Awaited<ReturnType<typeof testRender>>;

const LOCAL: GameSetup = { mode: "local", level: "medium", color: "w" };

let setup: Setup | null = null;

afterEach(async () => {
  await setup?.dispose();
  setup = null;
});

interface MountOptions {
  game?: GameSetup;
  width?: number;
  height?: number;
  onQuit?: () => void;
  onMenu?: () => void;
}

async function mount(options: MountOptions = {}) {
  const { width = 60, height = 24, onQuit = () => {}, onMenu = () => {} } = options;
  const game = options.game;
  setup = await testRender(
    () =>
      game ? (
        <GameScreen setup={game} onMenu={onMenu} onQuit={onQuit} botThinkMs={0} />
      ) : (
        <App onQuit={onQuit} botThinkMs={0} />
      ),
    { width, height },
  );
  await setup.renderOnce();
  return setup;
}

async function press(s: Setup, keys: string[]) {
  for (const key of keys) {
    if (key === "enter") s.mockInput.pressEnter();
    else if (key === "up" || key === "down" || key === "left" || key === "right") {
      s.mockInput.pressArrow(key);
    } else s.mockInput.pressKey(key);
    await s.renderOnce();
  }
  await s.flush();
  await s.renderOnce();
}

async function waitForFrame(s: Setup, predicate: (frame: string) => boolean) {
  for (let i = 0; i < 250; i++) {
    if (predicate(s.captureCharFrame())) return s.captureCharFrame();
    await Bun.sleep(20);
    await s.renderOnce();
  }
  throw new Error(`Timed out waiting for frame:\n${s.captureCharFrame()}`);
}

function movesToKeys(moves: string[], start = "e2") {
  const cursor = { file: "abcdefgh".indexOf(start[0] as string), rank: Number(start[1]) - 1 };
  const keys: string[] = [];
  const goTo = (square: string) => {
    const file = "abcdefgh".indexOf(square[0] as string);
    const rank = Number(square[1]) - 1;
    for (; cursor.file < file; cursor.file++) keys.push("l");
    for (; cursor.file > file; cursor.file--) keys.push("h");
    for (; cursor.rank < rank; cursor.rank++) keys.push("k");
    for (; cursor.rank > rank; cursor.rank--) keys.push("j");
    keys.push("enter");
  };
  for (const move of moves) {
    goTo(move.slice(0, 2));
    goTo(move.slice(2, 4));
  }
  return keys;
}

describe("home screen", () => {
  test("shows the menu with bot defaults", async () => {
    const s = await mount();
    const frame = s.captureCharFrame();
    expect(frame).toContain("Play vs bot");
    expect(frame).toContain("Medium");
    expect(frame).toContain("> Start game");
  });

  test("switches to a local game and starts it", async () => {
    const s = await mount();
    await press(s, ["up", "up", "up", "right"]);
    const menu = s.captureCharFrame();
    expect(menu).toContain("Play a friend (same terminal)");
    expect(menu).not.toContain("Difficulty");
    await press(s, ["enter"]);
    const frame = s.captureCharFrame();
    expect(frame).toContain("White to move.");
    expect(frame).toContain("White  White");
    expect(frame).toContain("Black  Black");
  });

  test("m in a game returns to the menu", async () => {
    const s = await mount();
    await press(s, ["enter"]);
    expect(s.captureCharFrame()).toContain("Bot (medium)");
    await press(s, ["m"]);
    expect(s.captureCharFrame()).toContain("> Start game");
  });

  test("q quits from the menu", async () => {
    let quit = false;
    const s = await mount({
      onQuit: () => {
        quit = true;
      },
    });
    await press(s, ["q"]);
    expect(quit).toBe(true);
  });
});

describe("local game", () => {
  test("renders the starting position on a small terminal", async () => {
    const s = await mount({ game: LOCAL });
    const frame = s.captureCharFrame();
    expect(frame).toContain("8  ♜  ♞  ♝  ♛  ♚  ♝  ♞  ♜");
    expect(frame).toContain("a  b  c  d  e  f  g  h");
    expect(frame).toContain("White to move.");
  });

  test("draws multi-line pieces on a large terminal and p toggles glyphs", async () => {
    const s = await mount({ game: LOCAL, width: 120, height: 32 });
    const art = s.captureCharFrame();
    expect(art).toContain("_+_");
    expect(art).toContain("(___)");
    expect(art).toContain("a      b      c      d      e      f      g      h");
    await press(s, ["p"]);
    const glyphs = s.captureCharFrame();
    expect(glyphs).toContain("♚");
    expect(glyphs).not.toContain("(___)");
  });

  test("plays e2-e4 with the keyboard", async () => {
    const s = await mount({ game: LOCAL });
    await press(s, ["enter", "k", "k", "enter"]);
    const frame = s.captureCharFrame();
    expect(frame).toContain("1.  e4");
    expect(frame).toContain("Black to move.");
  });

  test("plays scholar's mate to checkmate", async () => {
    const s = await mount({ game: LOCAL });
    await press(s, movesToKeys(["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"]));
    const frame = s.captureCharFrame();
    expect(frame).toContain("4.  Qxf7#");
    expect(frame).toContain("Checkmate. White wins.");
  });

  test("promotes to a knight with k", async () => {
    const s = await mount({ game: LOCAL, height: 30 });
    await press(
      s,
      movesToKeys(["a2a4", "b7b5", "a4b5", "a7a6", "b5a6", "c8b7", "a6b7", "h7h6", "b7a8"]),
    );
    expect(s.captureCharFrame()).toContain("Promote to");
    await press(s, ["k"]);
    const frame = s.captureCharFrame();
    expect(frame).toContain("bxa8=N");
    expect(frame).not.toContain("Promote to");
  });

  test("flips the board", async () => {
    const s = await mount({ game: LOCAL });
    await press(s, ["f"]);
    expect(s.captureCharFrame()).toContain("h  g  f  e  d  c  b  a");
  });

  test("undo takes back the last move", async () => {
    const s = await mount({ game: LOCAL });
    await press(s, ["enter", "k", "k", "enter"]);
    await press(s, ["u"]);
    const frame = s.captureCharFrame();
    expect(frame).not.toContain("1.  e4");
    expect(frame).toContain("White to move.");
  });

  test("q calls onQuit and m calls onMenu", async () => {
    let quit = false;
    let menu = false;
    const s = await mount({
      game: LOCAL,
      onQuit: () => {
        quit = true;
      },
      onMenu: () => {
        menu = true;
      },
    });
    await press(s, ["m", "q"]);
    expect(menu).toBe(true);
    expect(quit).toBe(true);
  });
});

describe("bot game", () => {
  test("the bot replies to your move", async () => {
    const s = await mount({ game: { mode: "bot", level: "easy", color: "w" } });
    expect(s.captureCharFrame()).toContain("Black  Bot (easy)");
    await press(s, ["enter", "k", "k", "enter"]);
    const frame = await waitForFrame(s, (f) => /1\. {2}e4 {6}\S/.test(f));
    expect(frame).toContain("White to move.");
  });

  test("undo takes back your move and the bot's reply", async () => {
    const s = await mount({ game: { mode: "bot", level: "easy", color: "w" } });
    await press(s, ["enter", "k", "k", "enter"]);
    await waitForFrame(s, (f) => /1\. {2}e4 {6}\S/.test(f));
    await press(s, ["u"]);
    const frame = s.captureCharFrame();
    expect(frame).not.toContain("1.  e4");
    expect(frame).toContain("White to move.");
  });

  test("playing black flips the board and the bot moves first", async () => {
    const s = await mount({ game: { mode: "bot", level: "easy", color: "b" } });
    expect(s.captureCharFrame()).toContain("h  g  f  e  d  c  b  a");
    const frame = await waitForFrame(s, (f) => f.includes("Black to move."));
    expect(frame).toMatch(/1\. {2}\S+/);
  });

  test("you can't move the bot's pieces", async () => {
    const s = await mount({ game: { mode: "bot", level: "easy", color: "b" } });
    await waitForFrame(s, (f) => f.includes("Black to move."));
    await press(s, ["enter", "k", "enter"]);
    expect(s.captureCharFrame()).toContain("Black to move.");
  });
});

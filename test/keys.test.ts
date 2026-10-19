import { describe, expect, test } from "bun:test";
import { keyToAction } from "../src/ui/keys.ts";
import { moveSquare } from "../src/ui/squares.ts";

describe("keyToAction", () => {
  test("maps arrows and hjkl to cursor moves", () => {
    expect(keyToAction({ name: "up" }, "board")).toEqual({ type: "cursor", dx: 0, dy: 1 });
    expect(keyToAction({ name: "k" }, "board")).toEqual({ type: "cursor", dx: 0, dy: 1 });
    expect(keyToAction({ name: "j" }, "board")).toEqual({ type: "cursor", dx: 0, dy: -1 });
    expect(keyToAction({ name: "h" }, "board")).toEqual({ type: "cursor", dx: -1, dy: 0 });
    expect(keyToAction({ name: "right" }, "board")).toEqual({ type: "cursor", dx: 1, dy: 0 });
  });

  test("maps board commands", () => {
    expect(keyToAction({ name: "return" }, "board")).toEqual({ type: "select" });
    expect(keyToAction({ name: "space" }, "board")).toEqual({ type: "select" });
    expect(keyToAction({ name: "u" }, "board")).toEqual({ type: "undo" });
    expect(keyToAction({ name: "f" }, "board")).toEqual({ type: "flip" });
    expect(keyToAction({ name: "n" }, "board")).toEqual({ type: "new" });
    expect(keyToAction({ name: "m" }, "board")).toEqual({ type: "menu" });
    expect(keyToAction({ name: "p" }, "board")).toEqual({ type: "pieceStyle" });
    expect(keyToAction({ name: "pageup" }, "board")).toEqual({ type: "scroll", delta: -5 });
    expect(keyToAction({ name: "pagedown" }, "board")).toEqual({ type: "scroll", delta: 5 });
    expect(keyToAction({ name: "q" }, "board")).toEqual({ type: "quit" });
    expect(keyToAction({ name: "escape" }, "board")).toEqual({ type: "cancel" });
    expect(keyToAction({ name: "x" }, "board")).toBeNull();
  });

  test("uses k for knight in the promotion picker", () => {
    expect(keyToAction({ name: "q" }, "promotion")).toEqual({ type: "promote", piece: "q" });
    expect(keyToAction({ name: "r" }, "promotion")).toEqual({ type: "promote", piece: "r" });
    expect(keyToAction({ name: "b" }, "promotion")).toEqual({ type: "promote", piece: "b" });
    expect(keyToAction({ name: "k" }, "promotion")).toEqual({ type: "promote", piece: "n" });
    expect(keyToAction({ name: "n" }, "promotion")).toBeNull();
    expect(keyToAction({ name: "escape" }, "promotion")).toEqual({ type: "cancel" });
  });

  test("ctrl+c always quits", () => {
    expect(keyToAction({ name: "c", ctrl: true }, "board")).toEqual({ type: "quit" });
    expect(keyToAction({ name: "c", ctrl: true }, "promotion")).toEqual({ type: "quit" });
  });
});

describe("moveSquare", () => {
  test("moves and clamps to the board edges", () => {
    expect(moveSquare("e2", 0, 1, false)).toBe("e3");
    expect(moveSquare("a1", -1, -1, false)).toBe("a1");
    expect(moveSquare("h8", 1, 1, false)).toBe("h8");
  });

  test("inverts direction when the board is flipped", () => {
    expect(moveSquare("e2", 0, 1, true)).toBe("e1");
    expect(moveSquare("e2", 1, 0, true)).toBe("d2");
  });
});

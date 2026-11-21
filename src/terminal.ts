import { emitKeypressEvents } from "node:readline";
import type { ColorMode } from "./ui/ansi";

/**
 * A key, normalised. `char` is a printable key (with `ctrl` for Ctrl+<letter>);
 * `special` is everything the terminal sends as an escape sequence. Keeping the
 * two apart is what lets the board bind both arrows and hjkl without a lookup
 * table that has to guess whether "h" meant a letter or a cursor key.
 */
export type Key =
  | { type: "char"; ch: string; ctrl: boolean; shift: boolean }
  | { type: "special"; name: "up" | "down" | "left" | "right" | "enter" | "escape" | "tab" | "backspace" | "space" | "unknown"; shift: boolean };

const SPECIALS: Record<string, Extract<Key, { type: "special" }>["name"]> = {
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  return: "enter",
  enter: "enter",
  escape: "escape",
  tab: "tab",
  backspace: "backspace",
  space: "space",
};

/** Node's keypress object, as `readline` actually emits it. */
export type RawKey = { sequence?: string; name?: string; ctrl?: boolean; shift?: boolean };

/**
 * Node reports `space` as a named key, and reports `?` as `shift+/` on some
 * terminals and as a bare `?` on others. Normalising here means the board's key
 * map never has to branch on terminal.
 */
export function normalizeKey(raw: RawKey): Key | null {
  const shift = raw.shift === true;
  const name = raw.name ?? "";
  const seq = raw.sequence ?? "";
  if (raw.ctrl && name && name.length === 1) return { type: "char", ch: name.toLowerCase(), ctrl: true, shift };
  const special = SPECIALS[name];
  if (special) return { type: "special", name: special, shift };
  // Shift+/ arrives as "?" on most terminals and as "/" plus shift on the rest.
  // Both have to reach the help key, so this is tested before the generic paths.
  if (seq === "?" || (name === "/" && shift)) return { type: "char", ch: "?", ctrl: false, shift };
  if (seq && seq.length === 1 && seq >= " ") return { type: "char", ch: seq, ctrl: false, shift };
  if (name && name.length === 1 && name >= " ") return { type: "char", ch: name, ctrl: false, shift };
  return null;
}

/**
 * What the terminal can be asked to paint. `NO_COLOR` outranks everything (its
 * whole point is that it cannot be overridden), and a `TERM` we do not recognise
 * drops to 256 colours rather than assuming truecolor and painting mush.
 */
export function colorModeOf(env: Record<string, string | undefined>): ColorMode {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return "none";
  const term = env.TERM ?? "";
  if (term === "dumb" || term === "") return "none";
  const colorterm = (env.COLORTERM ?? "").toLowerCase();
  if (colorterm === "truecolor" || colorterm === "24bit") return "truecolor";
  // TERM_PROGRAM is what VS Code and iTerm set even when COLORTERM is missing.
  if (/iterm|vscode|wezterm|ghostty|kitty|alacritty/i.test(env.TERM_PROGRAM ?? "")) return "truecolor";
  return "256";
}

export type Size = { cols: number; rows: number };

export interface Terminal {
  size(): Size;
  /** One full frame, already ANSI-encoded. The terminal decides how to land it. */
  draw(frame: string): void;
  onKey(fn: (key: Key) => void): void;
  onResize(fn: (size: Size) => void): void;
  start(): void;
  stop(): void;
  readonly colorMode: ColorMode;
}

type Streams = {
  stdin: NodeJS.ReadStream & { setRawMode?: (on: boolean) => void; isTTY?: boolean };
  stdout: NodeJS.WriteStream;
  env: Record<string, string | undefined>;
};

const clampSize = (s: Size): Size => ({ cols: Math.max(1, Math.floor(s.cols)), rows: Math.max(1, Math.floor(s.rows)) });

/**
 * Raw-mode stdin and whole-frame writes. No scene graph: the ui layer already
 * composes a complete frame, so the terminal's only job is to put it on screen
 * without tearing — cursor home, frame, and the cursor hidden while we do it.
 */
export class PlainTerminal implements Terminal {
  readonly colorMode: ColorMode;
  private keyFns: ((key: Key) => void)[] = [];
  private resizeFns: ((size: Size) => void)[] = [];
  private started = false;
  private readonly onWinch = () => {
    const size = this.size();
    for (const fn of this.resizeFns) fn(size);
  };

  constructor(private io: Streams = { stdin: process.stdin, stdout: process.stdout, env: process.env }) {
    this.colorMode = colorModeOf(io.env);
  }

  size(): Size {
    // A pty can report 0 (or nothing) before the first resize event, and `?? 80`
    // only catches `undefined` — a 0 went through and collapsed the screen to one
    // column of "terminal too small". Treat any non-positive report as unknown.
    const cols = this.io.stdout.columns;
    const rows = this.io.stdout.rows;
    return clampSize({
      cols: typeof cols === "number" && cols > 0 ? cols : 80,
      rows: typeof rows === "number" && rows > 0 ? rows : 24,
    });
  }

  draw(frame: string): void {
    // \x1b[H homes the cursor so every frame overwrites the last; \x1b[J clears
    // whatever the previous, taller frame left behind after a resize.
    this.io.stdout.write(`\x1b[H${frame}\x1b[J`);
  }

  onKey(fn: (key: Key) => void): void {
    this.keyFns.push(fn);
  }

  onResize(fn: (size: Size) => void): void {
    this.resizeFns.push(fn);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    emitKeypressEvents(this.io.stdin);
    this.io.stdin.on("keypress", this.handleKeypress);
    this.io.stdout.on("resize", this.onWinch);
    this.io.stdin.setRawMode?.(true);
    this.io.stdin.resume?.();
    this.io.stdout.write("\x1b[?1049h\x1b[?25l");
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.io.stdout.write("\x1b[?25h\x1b[?1049l");
    this.io.stdin.setRawMode?.(false);
    this.io.stdin.pause?.();
    this.io.stdin.off("keypress", this.handleKeypress);
    this.io.stdout.off("resize", this.onWinch);
  }

  private handleKeypress = (_sequence: string, raw: RawKey): void => {
    const key = normalizeKey(raw);
    if (!key) return;
    for (const fn of this.keyFns) fn(key);
  };
}

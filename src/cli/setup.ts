import { LEVELS, levelInfo } from "../engine/ladder";
import { toAnsi } from "../ui/ansi";
import { setupScreen } from "../ui/screens";
import { themeByKey, themes } from "../ui/theme";
import type { Key, Terminal } from "../terminal";
import type { Color } from "./args";

// Choosing a level is the one thing a first-run user must be able to do without
// reading --help, so bare `tokenmate` opens this instead of guessing level 8.
export type SetupResult = { level: number; color: Color; theme: string };

const COLORS: Color[] = ["white", "black", "random"];
const STRATEGY: Record<string, string> = { sampling: "sampled", "uci-elo": "native", full: "full" };

const isUp = (k: Key) => (k.type === "special" && k.name === "up") || (k.type === "char" && k.ch === "k");
const isDown = (k: Key) => (k.type === "special" && k.name === "down") || (k.type === "char" && k.ch === "j");
const isEnter = (k: Key) => k.type === "special" && (k.name === "enter" || k.name === "space");

export async function runSetup(terminal: Terminal, initial: SetupResult): Promise<SetupResult | null> {
  let stage: "main" | "level" = "main";
  let mainIndex = 0;
  let levelIndex = initial.level - 1;
  let color = initial.color;
  let themeKey = themeByKey(initial.theme) ? initial.theme : (themes[0]?.key ?? "slate");
  const mainRows = 5;

  // One listener feeding a queue: registering per keypress would stack handlers and
  // deliver every later key twice.
  const queue: Key[] = [];
  let waiter: ((k: Key | null) => void) | null = null;
  terminal.onKey((k) => {
    if (waiter) {
      const resolve = waiter;
      waiter = null;
      resolve(k);
    } else queue.push(k);
  });
  const nextKey = (): Promise<Key | null> =>
    queue.length ? Promise.resolve(queue.shift() ?? null) : new Promise<Key | null>((resolve) => (waiter = resolve));

  const theme = () => themeByKey(themeKey) ?? themes[0]!;

  const draw = (): void => {
    const { cols, rows } = terminal.size();
    const t = theme();
    if (stage === "main") {
      const info = levelInfo(levelIndex + 1);
      const options = [
        { label: "Play", note: `level ${info.level} · ${info.elo} Elo` },
        { label: "Level", note: `${info.level} of ${LEVELS.length}` },
        { label: "Colour", note: color },
        { label: "Theme", note: themeKey },
        { label: "Quit", note: "" },
      ];
      terminal.draw(
        toAnsi(
          setupScreen({
            cols,
            rows,
            theme: t,
            title: "tokenmate",
            options,
            selected: mainIndex,
            help: "↑↓ choose · enter select · esc quit · --model for a model seat",
          }),
          terminal.colorMode,
        ),
      );
      return;
    }
    const options = Array.from({ length: LEVELS.length }, (_, i) => {
      const info = levelInfo(i + 1);
      return { label: `Level ${info.level}`, note: `${info.elo} Elo · ${STRATEGY[info.strategy] ?? info.strategy}` };
    });
    terminal.draw(
      toAnsi(
        setupScreen({ cols, rows, theme: t, title: "Level", options, selected: levelIndex, help: "↑↓ choose · enter select · esc back" }),
        terminal.colorMode,
      ),
    );
  };

  terminal.start();
  try {
    draw();
    for (;;) {
      const key = await nextKey();
      if (!key) return null;
      if (isUp(key) || isDown(key)) {
        const delta = isDown(key) ? 1 : -1;
        if (stage === "main") mainIndex = (mainIndex + delta + mainRows) % mainRows;
        else levelIndex = Math.max(0, Math.min(LEVELS.length - 1, levelIndex + delta));
      } else if (isEnter(key)) {
        if (stage === "level") {
          stage = "main";
        } else if (mainIndex === 0) {
          return { level: levelIndex + 1, color, theme: themeKey };
        } else if (mainIndex === 1) {
          stage = "level";
        } else if (mainIndex === 2) {
          color = COLORS[(COLORS.indexOf(color) + 1) % COLORS.length] ?? "white";
        } else if (mainIndex === 3) {
          const keys = themes.map((x) => x.key);
          themeKey = keys[(keys.indexOf(themeKey) + 1) % keys.length] ?? themeKey;
        } else {
          return null;
        }
      } else if (key.type === "special" && key.name === "escape") {
        if (stage === "level") stage = "main";
        else return null;
      } else if (key.type === "char" && (key.ch === "q" || key.ch === "Q")) {
        return null;
      }
      draw();
    }
  } finally {
    terminal.stop();
  }
}

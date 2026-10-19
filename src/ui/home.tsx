import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import { createSignal, For } from "solid-js";
import { BOT_LEVELS, type BotLevel } from "../engine/bot.ts";
import type { ColorChoice, GameMode, GameSetup } from "../game/setup.ts";
import { keyToAction } from "./keys.ts";
import { theme } from "./theme.ts";

const MODES: { value: GameMode; label: string }[] = [
  { value: "bot", label: "Play vs bot" },
  { value: "local", label: "Play a friend (same terminal)" },
];

const LEVEL_LABELS: Record<BotLevel, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };

const COLORS: { value: ColorChoice; label: string }[] = [
  { value: "w", label: "White" },
  { value: "b", label: "Black" },
  { value: "random", label: "Random" },
];

type Row = "mode" | "level" | "color" | "start";

export interface HomeScreenProps {
  initial: GameSetup;
  onStart: (setup: GameSetup) => void;
  onQuit: () => void;
}

function cycle<T>(values: T[], current: T, step: number): T {
  const index = values.indexOf(current);
  return values[(index + step + values.length) % values.length] as T;
}

export function HomeScreen(props: HomeScreenProps) {
  const [setup, setSetup] = createSignal<GameSetup>({ ...props.initial });
  const [row, setRow] = createSignal<Row>("start");

  const rows = (): Row[] =>
    setup().mode === "bot" ? ["mode", "level", "color", "start"] : ["mode", "start"];

  const change = (step: number) => {
    const current = setup();
    switch (row()) {
      case "mode":
        setSetup({
          ...current,
          mode: cycle(
            MODES.map((m) => m.value),
            current.mode,
            step,
          ),
        });
        break;
      case "level":
        setSetup({ ...current, level: cycle(BOT_LEVELS, current.level, step) });
        break;
      case "color":
        setSetup({
          ...current,
          color: cycle(
            COLORS.map((c) => c.value),
            current.color,
            step,
          ),
        });
        break;
    }
  };

  useKeyboard((key) => {
    const action = keyToAction(key, "board");
    if (!action) return;
    switch (action.type) {
      case "cursor":
        if (action.dy !== 0) setRow(cycle(rows(), row(), -action.dy));
        else change(action.dx);
        break;
      case "select":
        props.onStart(setup());
        break;
      case "quit":
        props.onQuit();
        break;
    }
  });

  const options = (): { row: Row; label: string; value: string }[] => {
    const s = setup();
    const list = [
      {
        row: "mode" as Row,
        label: "Mode",
        value: MODES.find((m) => m.value === s.mode)?.label ?? "",
      },
    ];
    if (s.mode === "bot") {
      list.push({ row: "level", label: "Difficulty", value: LEVEL_LABELS[s.level] });
      list.push({
        row: "color",
        label: "Play as",
        value: COLORS.find((c) => c.value === s.color)?.label ?? "",
      });
    }
    return list;
  };

  return (
    <box flexDirection="column" padding={2} gap={1}>
      <ascii_font text="tokenmate" font="tiny" color={theme.accent} />
      <text>
        <span style={{ fg: theme.muted }}>Terminal chess where you bring your own AI.</span>
      </text>
      <box flexDirection="column">
        <For each={options()}>
          {(option) => {
            const active = () => row() === option.row;
            return (
              <text>
                <span style={{ fg: active() ? theme.accent : theme.muted }}>
                  {active() ? "> " : "  "}
                </span>
                <span style={{ fg: theme.muted }}>{option.label.padEnd(12)}</span>
                <span
                  style={{
                    fg: active() ? theme.accent : theme.text,
                    attributes: TextAttributes.BOLD,
                  }}
                >
                  {active() ? `< ${option.value} >` : `  ${option.value}`}
                </span>
              </text>
            );
          }}
        </For>
        <text>
          <span style={{ fg: row() === "start" ? theme.accent : theme.muted }}>
            {row() === "start" ? "> " : "  "}
          </span>
          <span
            style={{
              fg: row() === "start" ? theme.accent : theme.text,
              attributes: TextAttributes.BOLD,
            }}
          >
            Start game
          </span>
        </text>
      </box>
      <text>
        <span style={{ fg: theme.muted }}>
          up/down choose, left/right change, enter start, q quit
        </span>
      </text>
    </box>
  );
}

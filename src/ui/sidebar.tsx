import { type ScrollBoxRenderable, TextAttributes } from "@opentui/core";
import { For, Show } from "solid-js";
import type { Color, GameSnapshot } from "../game/game.ts";
import { theme } from "./theme.ts";

const COLOR_NAME: Record<Color, string> = { w: "White", b: "Black" };

const HELP: [string, string][] = [
  ["arrows/hjkl", "move cursor"],
  ["enter/space", "select / move"],
  ["esc", "cancel"],
  ["u", "undo"],
  ["f", "flip board"],
  ["p", "piece style"],
  ["pgup/pgdn", "scroll moves"],
  ["n", "new game"],
  ["m", "menu"],
  ["q", "quit"],
];

export interface SidebarProps {
  snapshot: GameSnapshot;
  message: string | null;
  playerNames: Record<Color, string>;
  thinking: string | null;
  movesRef?: (scrollbox: ScrollBoxRenderable) => void;
}

export function statusText(snapshot: GameSnapshot): string {
  const status = snapshot.status;
  switch (status.kind) {
    case "checkmate":
      return `Checkmate. ${COLOR_NAME[status.winner]} wins.`;
    case "draw":
      return `Draw by ${status.reason}.`;
    case "check":
      return `${COLOR_NAME[snapshot.turn]} to move. Check!`;
    default:
      return `${COLOR_NAME[snapshot.turn]} to move.`;
  }
}

export function moveRows(history: string[]): string[] {
  const rows: string[] = [];
  for (let i = 0; i < history.length; i += 2) {
    const number = `${i / 2 + 1}.`.padEnd(4);
    rows.push(`${number}${(history[i] ?? "").padEnd(8)}${history[i + 1] ?? ""}`);
  }
  return rows;
}

export function Sidebar(props: SidebarProps) {
  const over = () =>
    props.snapshot.status.kind === "checkmate" || props.snapshot.status.kind === "draw";

  return (
    <box flexDirection="column" width={30} flexGrow={1} gap={1}>
      <text>
        <span style={{ fg: theme.accent, attributes: TextAttributes.BOLD }}>tokenmate</span>
      </text>
      <box flexDirection="column">
        <text>
          <span style={{ fg: over() ? theme.accent : theme.text, attributes: TextAttributes.BOLD }}>
            {statusText(props.snapshot)}
          </span>
        </text>
        <Show when={props.thinking}>
          <text>
            <span style={{ fg: theme.muted }}>{props.thinking}</span>
          </text>
        </Show>
        <Show when={props.message}>
          <text>
            <span style={{ fg: theme.danger }}>{props.message}</span>
          </text>
        </Show>
      </box>
      <box flexDirection="column">
        <text>
          <span style={{ fg: theme.muted }}>{"White  "}</span>
          <span style={{ fg: theme.text }}>{props.playerNames.w}</span>
        </text>
        <text>
          <span style={{ fg: theme.muted }}>{"Black  "}</span>
          <span style={{ fg: theme.text }}>{props.playerNames.b}</span>
        </text>
      </box>
      <box flexDirection="column" flexGrow={1} flexShrink={1} flexBasis={0} minHeight={3}>
        <text>
          <span style={{ fg: theme.muted }}>Moves</span>
        </text>
        <scrollbox
          ref={props.movesRef}
          flexGrow={1}
          flexShrink={1}
          flexBasis={0}
          stickyScroll
          stickyStart="bottom"
        >
          <Show
            when={props.snapshot.history.length > 0}
            fallback={
              <text>
                <span style={{ fg: theme.muted }}>-</span>
              </text>
            }
          >
            <For each={moveRows(props.snapshot.history)}>
              {(row) => (
                <text>
                  <span style={{ fg: theme.text }}>{row}</span>
                </text>
              )}
            </For>
          </Show>
        </scrollbox>
      </box>
      <box flexDirection="column">
        <For each={HELP}>
          {([key, label]) => (
            <text>
              <span style={{ fg: theme.accent }}>{key.padEnd(13)}</span>
              <span style={{ fg: theme.muted }}>{label}</span>
            </text>
          )}
        </For>
      </box>
    </box>
  );
}

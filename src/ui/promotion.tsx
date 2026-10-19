import { TextAttributes } from "@opentui/core";
import { For } from "solid-js";
import { theme } from "./theme.ts";

const OPTIONS: [string, string][] = [
  ["q", "Queen"],
  ["r", "Rook"],
  ["b", "Bishop"],
  ["k", "Knight"],
];

export function PromotionPicker() {
  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={theme.accent}
      title="Promote to"
      paddingLeft={1}
      paddingRight={1}
    >
      <For each={OPTIONS}>
        {([key, label]) => (
          <text>
            <span style={{ fg: theme.accent, attributes: TextAttributes.BOLD }}>{key}</span>
            <span style={{ fg: theme.text }}>{`  ${label}`}</span>
          </text>
        )}
      </For>
      <text>
        <span style={{ fg: theme.muted }}>esc cancel</span>
      </text>
    </box>
  );
}

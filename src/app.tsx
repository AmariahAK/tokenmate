import { createSignal, Show } from "solid-js";
import { DEFAULT_SETUP, type GameSetup } from "./game/setup.ts";
import { GameScreen } from "./ui/game-screen.tsx";
import { HomeScreen } from "./ui/home.tsx";

export interface AppProps {
  onQuit: () => void;
  botThinkMs?: number;
}

export function App(props: AppProps) {
  const [active, setActive] = createSignal<GameSetup | null>(null);
  const [lastSetup, setLastSetup] = createSignal<GameSetup>(DEFAULT_SETUP);

  const start = (setup: GameSetup) => {
    setLastSetup(setup);
    setActive(setup);
  };

  return (
    <Show
      when={active()}
      keyed
      fallback={<HomeScreen initial={lastSetup()} onStart={start} onQuit={props.onQuit} />}
    >
      {(setup: GameSetup) => (
        <GameScreen
          setup={setup}
          onMenu={() => setActive(null)}
          onQuit={props.onQuit}
          botThinkMs={props.botThinkMs}
        />
      )}
    </Show>
  );
}

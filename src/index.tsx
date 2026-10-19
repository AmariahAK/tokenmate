import { createCliRenderer } from "@opentui/core";
import { render } from "@opentui/solid";
import { App } from "./app.tsx";

const renderer = await createCliRenderer({ exitOnCtrlC: false });

const quit = () => {
  renderer.destroy();
  process.exit(0);
};

await render(() => <App onQuit={quit} />, renderer);

import { type BotLevel, chooseMove } from "./bot.ts";

declare const self: Worker;

self.onmessage = (event: MessageEvent<{ fen: string; level: BotLevel }>) => {
  self.postMessage(chooseMove(event.data.fen, event.data.level));
};

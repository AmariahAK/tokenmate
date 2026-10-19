import type { BotLevel } from "../engine/bot.ts";
import type { Color } from "./game.ts";
import { BotPlayer, HumanPlayer, type Player } from "./player.ts";

export type GameMode = "bot" | "local";

export type ColorChoice = Color | "random";

export interface GameSetup {
  mode: GameMode;
  level: BotLevel;
  color: ColorChoice;
}

export const DEFAULT_SETUP: GameSetup = { mode: "bot", level: "medium", color: "w" };

export interface Lineup {
  players: Record<Color, Player>;
  humanColor: Color;
}

export function createLineup(setup: GameSetup, random = Math.random, botThinkMs?: number): Lineup {
  if (setup.mode === "local") {
    return {
      players: { w: new HumanPlayer("White"), b: new HumanPlayer("Black") },
      humanColor: "w",
    };
  }
  const humanColor: Color = setup.color === "random" ? (random() < 0.5 ? "w" : "b") : setup.color;
  const human = new HumanPlayer("You");
  const bot = new BotPlayer(setup.level, botThinkMs);
  return {
    players: humanColor === "w" ? { w: human, b: bot } : { w: bot, b: human },
    humanColor,
  };
}

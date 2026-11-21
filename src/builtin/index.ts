import type { Settings } from "../engine/any-uci";
import { levelPlan } from "../engine/ladder";
import type { Candidate, Score } from "../engine/uci";
import { Position, moveToUci } from "./position";
import { MATE, searchRoot } from "./search";

// The engine that makes tokenmate playable with nothing installed. Stockfish, or any
// other UCI engine, then becomes an upgrade rather than a prerequisite.
export const BUILTIN_NAME = "built-in";
export const BUILTIN_LABEL = "tokenmate built-in";

/**
 * Depth by level, and the estimate that goes with it. These numbers are estimates,
 * not measurements: we have no rated opponent to play a match against, so the note
 * says "estimate" and `doctor` says the same. Above the cap the honest thing is to
 * admit the ceiling and name the fix, not to print a level's Elo as if we could
 * reach it.
 */
const DEPTH_BY_LEVEL: [number, number][] = [
  [7, 2],
  [11, 3],
  [15, 4],
  [18, 5],
  [20, 6],
];

const ESTIMATE_BY_DEPTH: Record<number, number> = { 2: 700, 3: 1000, 4: 1200, 5: 1400, 6: 1550 };

export const builtinDepth = (level: number): number => {
  for (const [maxLevel, depth] of DEPTH_BY_LEVEL) if (level <= maxLevel) return depth;
  return 6;
};

export const BUILTIN_CAP = ESTIMATE_BY_DEPTH[6] ?? 1550;

export function builtinSettings(level: number): Settings {
  const plan = levelPlan(level);
  const depth = builtinDepth(level);
  const estimate = ESTIMATE_BY_DEPTH[depth] ?? BUILTIN_CAP;
  // A sampling level gets 8 scored root moves so the loss weighting has something to
  // choose between; above that one good move is all that is wanted.
  const multiPv = plan.strategy === "sampling" ? plan.multipv : 1;
  const elo = plan.strategy === "sampling" ? plan.elo : Math.min(plan.elo, estimate);
  const short = plan.strategy !== "sampling" && plan.elo > estimate;
  return {
    level,
    strategy: plan.strategy === "sampling" ? "sampling" : plan.strategy === "full" ? "full" : "handicap",
    elo,
    options: {},
    go: { depth, movetime: plan.movetime, ...(multiPv > 1 ? { multiPv } : {}) },
    note:
      `built-in engine · up to depth ${depth} · about ${estimate} Elo (estimate)` +
      (short ? ` — level ${level} asks for ${plan.elo}; install a UCI engine for more` : ""),
  };
}

const toScore = (centipawns: number): Score =>
  Math.abs(centipawns) > MATE - 100
    ? { type: "mate", value: centipawns > 0 ? Math.ceil((MATE - centipawns) / 2) : -Math.ceil((MATE + centipawns) / 2) }
    : { type: "cp", value: centipawns };

export type BuiltinSeat = {
  settings: Settings;
  search(fen: string, depth: number | null): Promise<Candidate[]>;
};

export function createBuiltin(level: number): BuiltinSeat {
  const settings = builtinSettings(level);
  const configured = typeof settings.go.depth === "number" ? settings.go.depth : 4;
  const movetime = settings.go.movetime ?? 1000;
  const multiPv = typeof settings.go.multiPv === "number" ? settings.go.multiPv : 1;
  return {
    settings,
    async search(fen, depth) {
      const pos = Position.fromFen(fen);
      const results = searchRoot(pos, {
        maxDepth: depth ?? configured,
        movetime,
        multiPv,
      });
      return results.map((r) => ({ move: moveToUci(r.move), score: toScore(r.score) }));
    },
  };
}

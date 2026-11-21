import { LEVELS, levelPlan, type Strategy } from "./ladder";
import type { GoOptions, Probe } from "./uci";

// Adapt a level to whatever engine is installed. The ladder says what a level
// means; this says what *this* engine can be asked for, and what it cannot do is
// stated rather than approximated quietly.
export type AdaptStrategy = Strategy | "skill" | "handicap";

export type Settings = {
  level: number;
  strategy: AdaptStrategy;
  /** What the engine will actually play at, clamped to its own range. Null when the
   *  engine advertises no range to clamp into. */
  elo: number | null;
  options: Record<string, string | number | boolean>;
  go: GoOptions;
  /** One line for `doctor` and the panels. */
  note: string;
};

export const HANDICAP_NOTE = "engine has no UCI_Elo, using depth handicap — strength is approximate";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The only honest knob left on an engine with no `UCI_Elo` and no `Skill Level` is
 * how hard it is allowed to look. This is a table of guesses, and every caller that
 * reads it prints HANDICAP_NOTE next to the level because of that.
 */
const handicap = (level: number) => ({
  depth: Math.min(12, 1 + Math.round((level - 1) / 2)),
  movetime: level >= LEVELS.length - 1 ? 2400 : 400,
});

/** "Skill Level" mapped across the whole ladder, so the scale is the engine's and
 *  not ours. */
const skillFor = (level: number, probe: Probe) => {
  const min = probe.skillLevel?.min ?? 0;
  const max = probe.skillLevel?.max ?? 20;
  return clamp(min + Math.round(((level - 1) / (LEVELS.length - 1)) * (max - min)), min, max);
};

export function adapt(level: number, probe: Probe): Settings {
  const plan = levelPlan(level);

  if (plan.strategy === "full") {
    const options: Record<string, string | number | boolean> = {};
    if (probe.hasUciElo) options.UCI_LimitStrength = false;
    if (probe.hasSkillLevel) options["Skill Level"] = probe.skillLevel?.max ?? 20;
    return {
      level,
      strategy: "full",
      elo: probe.uciElo?.max ?? null,
      options,
      go: { movetime: plan.movetime },
      note: "full strength, no handicap",
    };
  }

  if (plan.strategy === "sampling" && probe.hasMultiPV) {
    // The sampling *is* the strength at these levels, so nothing else is allowed to
    // handicap the same move twice — in particular not the Elo clamp, which cannot
    // reach this low and would only make level 7 weaker than level 1's target.
    return {
      level,
      strategy: "sampling",
      elo: plan.elo,
      options: probe.hasUciElo ? { UCI_LimitStrength: false } : {},
      go: { multiPv: plan.multipv, movetime: plan.movetime },
      note: `level ${level} samples ${plan.multipv} engine candidates by loss weight (about ${plan.elo} Elo); strength is approximate`,
    };
  }

  // 8–19, plus any level whose preferred strategy this engine cannot run.
  if (probe.hasUciElo && probe.uciElo) {
    const { min, max } = probe.uciElo;
    const elo = clamp(plan.elo, min, max);
    return {
      level,
      strategy: "uci-elo",
      elo,
      options: { UCI_LimitStrength: true, UCI_Elo: elo },
      go: { movetime: plan.movetime },
      note:
        elo === plan.elo
          ? `UCI_Elo ${elo}`
          : `UCI_Elo ${elo} (clamped: level ${level} asks for ${plan.elo}, the engine reports ${min}–${max})`,
    };
  }

  if (probe.hasSkillLevel) {
    const skill = skillFor(level, probe);
    return {
      level,
      strategy: "skill",
      elo: plan.elo,
      options: { "Skill Level": skill },
      go: { movetime: plan.movetime },
      note: `engine has no UCI_Elo; level ${level} is Skill Level ${skill} — strength is approximate`,
    };
  }

  const h = handicap(level);
  return {
    level,
    strategy: "handicap",
    elo: plan.elo,
    options: {},
    go: { depth: h.depth, movetime: h.movetime },
    note: HANDICAP_NOTE,
  };
}

/** What `doctor` and the level picker say about this engine before a game starts. */
export function strengthNote(probe: Probe): string {
  if (probe.uciElo) return `UCI_Elo ${probe.uciElo.min}–${probe.uciElo.max}`;
  if (probe.hasSkillLevel) return "engine has no UCI_Elo; levels 8–19 map to Skill Level — strength is approximate";
  return HANDICAP_NOTE;
}

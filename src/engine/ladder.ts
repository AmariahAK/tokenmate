import { scoreCp, type Candidate, type Score } from "./uci";

// A level is a number and a strength, nothing else. No named presets: "easy" and
// "magnus" are a marketing layer over the same integer, and one of them is a
// person's name rather than a setting.
export type Strategy = "sampling" | "uci-elo" | "full";

export type LevelInfo = { level: number; elo: number; strategy: Strategy };

// The table, and the only place a level's strength is written down.
//
// 1–7 cannot be a `UCI_Elo` setting, because no engine can be asked to play below
// its own floor — Stockfish's is 1320, measured. They sample among the engine's own
// MultiPV candidates instead, weighted by how much eval each move gives up, so the
// Elo printed for those levels is a statement about the loss weighting rather than
// about anything the engine was told.
// 8–19 are native `UCI_Elo`, 1320 → 3190 in even 170 steps: the measured clamp.
// 20 is the engine with no handicap at all, which is stronger than any `UCI_Elo`
// value it accepts, so its number stays at the cap instead of inventing strength
// the engine has never claimed.
const SAMPLING_ELO = [300, 450, 600, 750, 900, 1050, 1200];
const ELO_FLOOR = 1320;
const ELO_CEIL = 3190;
const ELO_STEP = 170;
const NATIVE_LEVELS = 12;

export const LEVELS: readonly LevelInfo[] = [
  ...SAMPLING_ELO.map((elo, i) => ({ level: i + 1, elo, strategy: "sampling" as const })),
  ...Array.from({ length: NATIVE_LEVELS }, (_, i) => ({
    level: i + SAMPLING_ELO.length + 1,
    elo: ELO_FLOOR + i * ELO_STEP,
    strategy: "uci-elo" as const,
  })),
  { level: SAMPLING_ELO.length + NATIVE_LEVELS + 1, elo: ELO_CEIL, strategy: "full" as const },
];

export type Plan = {
  level: number;
  elo: number;
  strategy: Strategy;
  /** Candidates to ask for; 1 when the level does not sample. */
  multipv: number;
  /** Centipawn decay for loss weighting. Bigger = bad moves chosen more often. */
  spread: number;
  /** Search cap in ms. A level must never pause the board to think about it. */
  movetime: number;
};

// 8 candidates costs ~325 ms measured, which is why a sampling level can be weak
// and still feel instant.
const SAMPLE_PV = 8;
const SPREAD = [520, 420, 330, 250, 180, 120, 80];
const MOVETIME = { sampling: 300, native: 1000, full: 2400 };

export function levelInfo(n: number): LevelInfo {
  const hit = LEVELS[n - 1];
  if (!hit || hit.level !== n) throw new Error(`level ${n} is not on the ladder; tokenmate has 1–${LEVELS.length}`);
  return hit;
}

export function levelPlan(n: number): Plan {
  const info = levelInfo(n);
  if (info.strategy === "sampling") {
    return { ...info, multipv: SAMPLE_PV, spread: SPREAD[n - 1] ?? 80, movetime: MOVETIME.sampling };
  }
  if (info.strategy === "uci-elo") return { ...info, multipv: 1, spread: 0, movetime: MOVETIME.native };
  return { ...info, multipv: 1, spread: 0, movetime: MOVETIME.full };
}

// mulberry32: 32 bits of state, no dependency, and — because it is a plain integer
// generator — the same seed gives the same game on every machine a replay runs on.
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Loss-weighted sampling over the engine's own candidates: a move is chosen with
 * probability `exp(-loss / spread)`, where loss is the centipawns it gives up
 * against the best move in the same search. A weaker level has a bigger spread, so
 * it takes a worse move more often — which is what a weak player does, rather than
 * what a weak search finds.
 */
export function pickMove(candidates: Candidate[], plan: Plan, random: () => number): string {
  const first = candidates[0];
  if (!first) throw new Error(`level ${plan.level}: no candidate moves to sample`);
  if (plan.spread <= 0) return bestOf(candidates).move;

  const ranked = [...candidates].sort((a, b) => scoreCp(b.score) - scoreCp(a.score));
  const best = scoreCp(ranked[0]?.score ?? first.score);
  const weights = ranked.map((c) => Math.exp(-(best - scoreCp(c.score)) / plan.spread));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let target = random() * total;
  for (let i = 0; i < ranked.length; i++) {
    target -= weights[i] ?? 0;
    const candidate = ranked[i];
    if (target < 0 && candidate) return candidate.move;
  }
  return ranked[ranked.length - 1]?.move ?? first.move;
}

const bestOf = (candidates: Candidate[]): Candidate =>
  candidates.reduce((best, c) => (scoreCp(c.score) > scoreCp(best.score) ? c : best));

export const bestScore = (candidates: Candidate[]): Score => bestOf(candidates).score;

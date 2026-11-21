// The engine's public surface. `ui` and `game` never import this; only `cli` and the
// screens above them do, which is why the four modules below can be tested one at a
// time with a fake engine and no terminal.
export { analyse, bestLine, candidates, classify, INACCURACY, MISTAKE, BLUNDER, toWhite } from "./analysis";
export type { Analysis, Verdict } from "./analysis";
export { adapt, HANDICAP_NOTE, strengthNote } from "./any-uci";
export type { AdaptStrategy, Settings } from "./any-uci";
export { bestScore, LEVELS, levelInfo, levelPlan, pickMove, seededRandom } from "./ladder";
export type { LevelInfo, Plan, Strategy } from "./ladder";
export { doctor, installHint, noEngineMessage, resolveEngine, splitCommand } from "./resolve";
export type { DoctorOptions, DoctorReport, Resolved, ResolveOptions, Source } from "./resolve";
export { LineSplitter, MATE_CP, parseInfo, parseOption, scoreCp, UciEngine } from "./uci";
export type {
  Candidate,
  EngineOption,
  GoOptions,
  GoResult,
  InfoLine,
  Probe,
  Score,
  UciOptions,
} from "./uci";

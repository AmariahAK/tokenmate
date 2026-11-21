import { scoreCp, type Candidate, type InfoLine, type Score } from "./uci";

// Everything here reads the `info` lines the move search already produced. A second
// search would double the latency and could disagree with the move that was played,
// which is the one thing an eval panel must never do.
export type Verdict = "best" | "inaccuracy" | "mistake" | "blunder" | "unrated";

export type Analysis = {
  /** White's perspective, so the eval bar has one sign convention and mate stays a
   *  mate instead of being flattened into centipawns. */
  eval: Score;
  /** Best line the engine reported for the position that was searched. */
  pv: string[];
  best: Candidate | null;
  played: Candidate | null;
  /** Centipawns given up against the best candidate, or null when the engine never
   *  scored the move that was played (MultiPV 1 scores exactly one move). */
  loss: number | null;
  verdict: Verdict;
};

// Where each verdict starts, in centipawns lost. One boundary per label, and the
// test asserts the exact values, because a blunder detector that drifts is noise in
// the review screen rather than information.
export const INACCURACY = 50;
export const MISTAKE = 100;
export const BLUNDER = 300;

/** UCI scores are from the side to move; the eval bar is always White's. */
export const toWhite = (s: Score, turn: "w" | "b"): Score =>
  turn === "w" ? s : { type: s.type, value: -s.value };

const ZERO: Score = { type: "cp", value: 0 };

/** The deepest line for rank 1 — what "the engine's line" means. */
export function bestLine(info: InfoLine[]): InfoLine | null {
  let out: InfoLine | null = null;
  for (const line of info) if (line.multipv === 1 && (!out || line.depth >= out.depth)) out = line;
  return out;
}

/**
 * One candidate per MultiPV rank, deepest line per rank. Scores stay from the side
 * to move, which is what loss weighting wants: a loss is a difference between two
 * scores from the same search, so the perspective cancels.
 */
export function candidates(info: InfoLine[]): Candidate[] {
  const deepest = new Map<number, InfoLine>();
  for (const line of info) {
    const seen = deepest.get(line.multipv);
    if (!seen || line.depth >= seen.depth) deepest.set(line.multipv, line);
  }
  return [...deepest.values()]
    .sort((a, b) => a.multipv - b.multipv)
    .flatMap((line) => {
      const move = line.pv[0];
      return move ? [{ move, score: line.score }] : [];
    });
}

export function classify(loss: number | null): Verdict {
  if (loss === null) return "unrated";
  if (loss >= BLUNDER) return "blunder";
  if (loss >= MISTAKE) return "mistake";
  if (loss >= INACCURACY) return "inaccuracy";
  return "best";
}

/** Pure over the `InfoLine[]` from the call that produced the move. */
export function analyse(played: string | null, info: InfoLine[], turn: "w" | "b"): Analysis {
  const ranked = candidates(info);
  const best = ranked[0] ?? null;
  const top = bestLine(info);
  const chosen = played ? (ranked.find((c) => c.move === played) ?? null) : null;
  const loss = best && chosen ? Math.max(0, scoreCp(best.score) - scoreCp(chosen.score)) : null;
  return {
    eval: toWhite(top?.score ?? best?.score ?? ZERO, turn),
    pv: top?.pv ?? [],
    best,
    played: chosen,
    loss,
    verdict: classify(loss),
  };
}

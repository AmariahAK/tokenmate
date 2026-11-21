/**
 * Deterministic randomness for `--seed`. A factory and not module state: two
 * sessions handed the same seed must produce the same sequence, and one caller
 * must not be able to advance another caller's stream.
 */
export type Rng = {
  /** The normalised seed this stream came from, for logging and resume. */
  readonly seed: number;
  /** Next value in [0, 1). */
  next(): number;
  /** Next integer in [0, max). */
  int(max: number): number;
  pick<T>(items: readonly T[]): T;
  /** A shuffled copy — the argument is never mutated. */
  shuffle<T>(items: readonly T[]): T[];
};

// mulberry32: 32 bits of state, four lines, and good enough for picking an
// opening or sampling a MultiPV list. Anything stronger would be theatre here.
const mulberry32 = (state: number) => () => {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), state | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const normalise = (seed: number) => (Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0);

export function makeRng(seed: number): Rng {
  const origin = normalise(seed);
  const step = mulberry32(origin);
  return {
    seed: origin,
    next: step,
    int: (max) => Math.floor(step() * max),
    pick: (items) => {
      if (items.length === 0) throw new Error("cannot pick from an empty list");
      return items[Math.floor(step() * items.length)]!;
    },
    shuffle: (items) => {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(step() * (i + 1));
        const held = out[i]!;
        out[i] = out[j]!;
        out[j] = held;
      }
      return out;
    },
  };
}

/** FNV-1a, so `--seed=blackmar` is a number without a second flag. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A seed for a run that did not ask to be reproducible. */
export function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]!;
}

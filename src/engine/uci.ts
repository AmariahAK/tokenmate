// The process boundary: one engine, driven over stdio, that tokenmate does not
// ship and never will. Nothing in here knows what a chess move means — and nothing
// in here may leave a child behind, because an orphaned engine eating a core is the
// one failure mode a TUI cannot recover from.

const DEFAULT_GO_TIMEOUT = 30_000;
const DEFAULT_START_TIMEOUT = 10_000;
const DEFAULT_GRACE = 250;

const spawn = (cmd: string[]) => Bun.spawn({ cmd, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
type Proc = ReturnType<typeof spawn>;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Bun carries the IO mode of a subprocess in its type parameters, and the widened
// form is not always narrow enough to prove that `stdin: "pipe"` gave us a sink. The
// checks below are the proof, at the one place that touches each side of the pipe.
type Sink = {
  write(chunk: string): unknown;
  flush(): number | Promise<number>;
  end(error?: Error): number | Promise<number>;
};

const sinkOf = (s: unknown): Sink | null => {
  const sink = s as Partial<Sink> | null | undefined;
  return sink && typeof sink.write === "function" && typeof sink.flush === "function" ? (sink as Sink) : null;
};

const streamOf = (s: unknown): ReadableStream => s as ReadableStream;

export type Score = { type: "cp" | "mate"; value: number };

/** A candidate move with the engine's own score, which is always from the point of
 *  view of the side to move. */
export type Candidate = { move: string; score: Score };

export type InfoLine = { depth: number; multipv: number; score: Score; pv: string[] };

export type GoOptions = {
  depth?: number;
  movetime?: number;
  nodes?: number;
  multiPv?: number;
  elo?: number;
  skill?: number;
  searchmoves?: string[];
};

export type GoResult = { bestmove: string; info: InfoLine[] };

export type EngineOption = {
  name: string;
  type: string;
  default: string | null;
  min: number | null;
  max: number | null;
};

/** What this engine can actually be asked for. The ladder adapts to this rather
 *  than to Stockfish. */
export type Probe = {
  hasUciElo: boolean;
  uciElo: { min: number; max: number } | null;
  hasSkillLevel: boolean;
  skillLevel: { min: number; max: number } | null;
  hasMultiPV: boolean;
  multipvMax: number | null;
};

export type UciOptions = { goTimeout?: number; startTimeout?: number; grace?: number };

// Mate outranks any centipawn score, so a move that misses mate compares as the
// disaster it was.
export const MATE_CP = 10_000;
export const scoreCp = (s: Score) =>
  s.type === "cp" ? s.value : s.value > 0 ? MATE_CP - s.value : -MATE_CP - s.value;

/**
 * Turns byte chunks into whole lines. A pipe splits wherever it likes, so "one
 * chunk is one line" works right up until the first `bestmove` straddles two reads
 * — which happens on exactly the slow engines the timeout path exists for.
 */
export class LineSplitter {
  private decoder = new TextDecoder();
  private buf = "";

  constructor(private onLine: (line: string) => void) {}

  push(chunk: Uint8Array) {
    this.buf += this.decoder.decode(chunk, { stream: true });
    let nl = this.buf.indexOf("\n");
    while (nl >= 0) {
      this.onLine(this.buf.slice(0, nl).replace(/\r$/, ""));
      this.buf = this.buf.slice(nl + 1);
      nl = this.buf.indexOf("\n");
    }
  }

  /** Whatever arrived without a trailing newline before the stream closed. */
  flush() {
    const rest = this.buf.trim();
    this.buf = "";
    if (rest) this.onLine(rest);
  }
}

// option name UCI_Elo type spin default 1320 min 1320 max 3190
export function parseOption(line: string): EngineOption | null {
  const m = /^option name (.+?) type (\w+)(.*)$/.exec(line);
  const name = m?.[1];
  const type = m?.[2];
  if (!name || !type) return null;
  const rest = m?.[3] ?? "";
  const text = (key: string) => new RegExp(`${key} (\\S+)`).exec(rest)?.[1] ?? null;
  const num = (key: string) => {
    const raw = text(key);
    const n = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  return { name, type, default: text("default"), min: num("min"), max: num("max") };
}

export function parseInfo(line: string): InfoLine | null {
  const t = line.trim().split(/\s+/);
  let depth = 0;
  let multipv = 1;
  let score: Score | null = null;
  let pv: string[] = [];
  for (let i = 1; i < t.length; i++) {
    const key = t[i];
    if (key === "depth") depth = Number(t[i + 1]) || 0;
    else if (key === "multipv") multipv = Number(t[i + 1]) || 1;
    else if (key === "score") {
      const kind = t[i + 1];
      const value = Number(t[i + 2]);
      // `lowerbound`/`upperbound` are not exact scores; a fail-high is not an eval.
      if ((kind === "cp" || kind === "mate") && Number.isFinite(value)) {
        score = { type: kind, value };
        i += 2;
      }
    } else if (key === "pv") {
      pv = t.slice(i + 1);
      break;
    }
  }
  return score && pv.length ? { depth, multipv, score, pv } : null;
}

export class UciEngine {
  private proc: Proc | null = null;
  private queue: string[] = [];
  private waiters: (() => void)[] = [];
  private ended = false;
  private closing: Promise<void> | null = null;
  private name: string | null = null;
  private advertised = new Map<string, EngineOption>();
  private err = "";
  private goTimeout: number;
  private startTimeout: number;
  private grace: number;

  constructor(private cmd: string[], opts: UciOptions = {}) {
    this.goTimeout = opts.goTimeout ?? DEFAULT_GO_TIMEOUT;
    this.startTimeout = opts.startTimeout ?? DEFAULT_START_TIMEOUT;
    this.grace = opts.grace ?? DEFAULT_GRACE;
  }

  get pid(): number | null {
    return this.proc?.pid ?? null;
  }

  get id(): string | null {
    return this.name;
  }

  /** `uci` → `uciok`, then `isready` → `readyok`, which is what makes the first
   *  move fast instead of paying the engine's own warm-up. */
  async start(): Promise<Probe> {
    if (this.proc) return this.probe();
    this.queue = [];
    this.ended = false;
    this.err = "";
    // A restart after dispose must not inherit the old latch, or the next dispose
    // would return a resolved promise and leave the new child running.
    this.closing = null;
    const proc = spawn(this.cmd);
    this.proc = proc;
    const splitter = new LineSplitter((line) => {
      this.queue.push(line);
      this.wake();
    });
    void this.pump(streamOf(proc.stdout), splitter)
      .catch(() => {})
      .finally(() => {
        splitter.flush();
        this.ended = true;
        this.wake();
      });
    // stderr must be drained too: an engine that logs would otherwise block on a
    // full pipe, and its last words are worth having in a timeout message.
    const errSplitter = new LineSplitter((line) => {
      this.err = `${this.err}\n${line}`.slice(-2000);
    });
    void this.pump(streamOf(proc.stderr), errSplitter).catch(() => {});

    await this.send("uci");
    const deadline = Date.now() + this.startTimeout;
    for (;;) {
      const line = await this.line(deadline, "uciok");
      if (line === "uciok") break;
      if (line.startsWith("id name ")) this.name = line.slice(8).trim();
      else if (line.startsWith("option ")) {
        const opt = parseOption(line);
        if (opt) this.advertised.set(opt.name, opt);
      }
    }
    await this.sync();
    return this.probe();
  }

  probe(): Probe {
    const range = (o: EngineOption | undefined) =>
      o && o.min !== null && o.max !== null ? { min: o.min, max: o.max } : null;
    const elo = this.advertised.get("UCI_Elo");
    const skill = this.advertised.get("Skill Level");
    const multipv = this.advertised.get("MultiPV");
    return {
      hasUciElo: elo !== undefined,
      uciElo: range(elo),
      hasSkillLevel: skill !== undefined,
      skillLevel: range(skill),
      hasMultiPV: multipv !== undefined,
      multipvMax: multipv?.max ?? null,
    };
  }

  async setOption(name: string, value: string | number | boolean): Promise<void> {
    await this.send(`setoption name ${name} value ${value}`);
  }

  async newGame(): Promise<void> {
    await this.send("ucinewgame");
    await this.sync();
  }

  async position(fen = "startpos", moves: string[] = []): Promise<void> {
    const base = fen === "startpos" || fen === "" ? "startpos" : `fen ${fen}`;
    await this.send(`position ${base}${moves.length ? ` moves ${moves.join(" ")}` : ""}`);
  }

  /**
   * The strength options travel with the search on purpose: the move and the lines
   * analysis reads have to come from the same call, so no caller can pair a move
   * with another search's eval.
   */
  async go(opts: GoOptions = {}): Promise<GoResult> {
    if (opts.multiPv != null) await this.setOption("MultiPV", opts.multiPv);
    if (opts.skill != null) await this.setOption("Skill Level", opts.skill);
    if (opts.elo != null) {
      await this.setOption("UCI_LimitStrength", true);
      await this.setOption("UCI_Elo", opts.elo);
    }
    const words = ["go"];
    if (opts.searchmoves?.length) words.push("searchmoves", ...opts.searchmoves);
    if (opts.depth != null) words.push("depth", String(opts.depth));
    if (opts.movetime != null) words.push("movetime", String(opts.movetime));
    if (opts.nodes != null) words.push("nodes", String(opts.nodes));
    await this.send(words.join(" "));

    const info: InfoLine[] = [];
    const deadline = Date.now() + this.goTimeout;
    for (;;) {
      const line = await this.line(deadline, "bestmove");
      if (line.startsWith("bestmove")) {
        const move = line.split(/\s+/)[1];
        if (!move) throw new Error(`engine sent a bestmove line with no move: ${line}`);
        return { bestmove: move, info };
      }
      const parsed = line.startsWith("info ") ? parseInfo(line) : null;
      if (parsed) info.push(parsed);
    }
  }

  /** Best effort: UCI answers a running search with `bestmove`, and ignores it when
   *  nothing is searching. */
  async stop(): Promise<void> {
    try {
      await this.send("stop");
    } catch {
      // Nothing is running, which is the state we wanted anyway.
    }
  }

  /** Sends `quit`, then SIGTERM, then SIGKILL. Safe to call twice. */
  async quit(): Promise<void> {
    this.closing ??= this.shutdown();
    return this.closing;
  }

  async dispose(): Promise<void> {
    await this.quit();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.quit();
  }

  private async shutdown(): Promise<void> {
    const proc = this.proc;
    this.proc = null;
    if (!proc) return;
    const sink = sinkOf(proc.stdin);
    if (sink) {
      // Already gone; the kill sequence below is the point, not the goodbye.
      try {
        sink.write("quit\n");
        await sink.flush();
        await sink.end();
      } catch {}
    }
    if (proc.exitCode === null) await Promise.race([proc.exited, delay(this.grace)]);
    if (proc.exitCode === null) {
      try {
        proc.kill();
      } catch {}
      await Promise.race([proc.exited, delay(this.grace)]);
    }
    if (proc.exitCode === null) {
      try {
        proc.kill("SIGKILL");
      } catch {}
      // Never let a wedged child hold the event loop: the OS reaps it either way.
      await Promise.race([proc.exited, delay(1000)]);
    }
    this.ended = true;
    this.wake();
  }

  private async sync(): Promise<void> {
    await this.send("isready");
    const deadline = Date.now() + this.startTimeout;
    while ((await this.line(deadline, "readyok")) !== "readyok") {
      // Engines interleave `info string` chatter with the handshake; skip it.
    }
  }

  private async send(cmd: string): Promise<void> {
    const sink = sinkOf(this.proc?.stdin);
    if (!sink) throw new Error("engine is not running");
    sink.write(`${cmd}\n`);
    await sink.flush();
  }

  private async pump(stream: ReadableStream, splitter: LineSplitter): Promise<void> {
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      splitter.push(value);
    }
  }

  private async line(deadline: number, what: string): Promise<string> {
    for (;;) {
      const next = this.queue.shift();
      if (next !== undefined) return next;
      if (this.ended) throw new Error(`engine exited before ${what}${this.tail()}`);
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`engine did not answer ${what} within the deadline${this.tail()}`);
      await this.waitFor(left);
    }
  }

  private waitFor(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        const at = this.waiters.indexOf(done);
        if (at >= 0) this.waiters.splice(at, 1);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.waiters.push(done);
    });
  }

  private wake() {
    for (const waiter of this.waiters.splice(0)) waiter();
  }

  private tail(): string {
    const last = this.err.trim().split("\n").slice(-3).join(" | ");
    return last ? ` (stderr: ${last})` : "";
  }
}

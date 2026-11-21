import type { Session } from "../game/session";
import type { Key, Terminal } from "../terminal";
import { toAnsi } from "../ui/ansi";
import { gameScreen, helpScreen, type GameView } from "../ui/screens";
import { themes, type Theme } from "../ui/theme";
import type { Settings } from "../engine/any-uci";
import type { Candidate, Probe } from "../engine/uci";
import { analyse, type Analysis } from "../engine/analysis";
import { levelPlan, pickMove } from "../engine/ladder";
import { askForMove, buildView, type ChatFn } from "../models/brain";

/** What the loop needs from an engine, so a test can supply a scripted one. */
export type EngineSeat = {
  settings: Settings;
  /** One search from a position; candidates arrive best-first. */
  search(fen: string, depth: number | null): Promise<Candidate[]>;
};

export type Seat = { kind: "human" } | { kind: "engine" } | { kind: "model"; chat: ChatFn; name: string };

export type GameOptions = {
  session: Session;
  terminal: Terminal;
  theme: Theme;
  seatOf: { white: Seat; black: Seat };
  /** Display names for the header: "you", "engine · level 8", "ollama/qwen3". */
  labelOf: { white: string; black: string };
  engine: EngineSeat | null;
  level: number;
  levelElo: number;
  depth: number | null;
};

const emptyAnalysis = (): Analysis => ({ verdict: "unrated", loss: null, eval: { type: "cp", value: 0 }, best: null, played: null, pv: [] });

const sideName = (c: "w" | "b") => (c === "w" ? "white" : "black");

/**
 * The interactive game. The session is the only truth: this owns cursor and panel
 * state and redraws. Every move still goes through `session.move`, so no keypress
 * can put an illegal position on the board.
 */
export async function runGame(opts: GameOptions): Promise<void> {
  const { session, terminal } = opts;
  let cursor = { file: 4, rank: 3 }; // e4
  let selected: string | null = null;
  let help = false;
  let notice: string | null = null;
  let thoughts: string | null = null;
  let analysis: Analysis = emptyAnalysis();
  let hints: string[] = [];
  let theme = opts.theme;
  let thinking = false;
  let finished = false;

  const squareName = (f: number, r: number) => `${"abcdefgh"[f]}${r + 1}`;
  const seatFor = (c: "w" | "b") => (c === "w" ? opts.seatOf.white : opts.seatOf.black);

  const render = (): void => {
    const { cols, rows } = terminal.size();
    const st = session.status();
    if (help) {
      terminal.draw(toAnsi(helpScreen(cols, rows, theme), terminal.colorMode));
      return;
    }
    const clk = session.clock();
    const last = st.history.at(-1);
    const view: GameView = {
      cols,
      rows,
      theme,
      fen: st.fen,
      marks: {
        ...(selected ? { selected } : {}),
        ...(last ? { lastMove: [last.from, last.to] as [string, string] } : {}),
      },
      hints,
      moves: st.history.map((p) => p.san),
      ply: st.ply,
      evalCp: analysis.eval?.type === "cp" ? analysis.eval.value : null,
      mateIn: analysis.eval?.type === "mate" ? analysis.eval.value : null,
      bestLine: analysis.best?.move ?? (analysis.pv.length ? analysis.pv.slice(0, 3).join(" ") : null),
      thoughts: thinking ? "thinking…" : thoughts,
      status: statusLine(opts, st),
      level: opts.level,
      levelElo: opts.levelElo,
      opponent: `${opts.labelOf.white} vs ${opts.labelOf.black}`,
      engine: opts.engine?.settings.note ?? null,
      clocks: clk ? { white: clk.whiteMs, black: clk.blackMs } : null,
      ...(notice ? { notice } : {}),
    };
    terminal.draw(toAnsi(gameScreen(view), terminal.colorMode));
  };

  /**
   * One search feeds the eval bar, the analysis panel and the played move. Asking
   * twice would let the panel disagree with the board.
   */
  const search = async (): Promise<Candidate[] | null> => {
    if (!opts.engine) return null;
    const st = session.status();
    if (!session.legalMoves().length) return null;
    const candidates = await opts.engine.search(st.fen, opts.depth);
    const lines = candidates.map((c, i) => ({ depth: 0, multipv: i + 1, score: c.score, pv: [c.move] }));
    analysis = analyse(candidates[0]?.move ?? null, lines, st.turn);
    return candidates;
  };

  const engineTurn = async (): Promise<void> => {
    const candidates = await search();
    if (!candidates?.length) throw new Error("the engine returned no candidate moves");
    const move = pickMove(candidates, levelPlan(opts.level), () => session.rng.next());
    hints = [];
    const applied = session.move(move);
    // The move came from the engine's own list, so a refusal means the board and
    // the search disagreed. Say so instead of retrying into a loop.
    if (!applied.ok) throw new Error(`engine chose ${move}, which this position rejects (${applied.detail})`);
  };

  const modelTurn = async (seat: Extract<Seat, { kind: "model" }>): Promise<void> => {
    const st = session.status();
    const view = buildView({
      fen: st.fen,
      legal: session.legalMoves().map((m) => ({ san: m.san, uci: m.uci })),
      history: st.history.slice(-3).map((p) => p.san),
      check: st.check,
    });
    const result = await askForMove(view, seat.chat, { mode: "opponent", timeoutMs: 30_000 });
    if (result.ok) {
      thoughts = result.move.comment ?? null;
      const applied = session.move(result.move.uci || result.move.san);
      if (applied.ok) {
        notice = null;
        return;
      }
      // The footer is one row and clips, so the outcome comes first and the reason
      // goes to the panel where there is room for it.
      notice = `${seat.name}'s move was rejected — the engine moved instead`;
      thoughts = `rejected: ${applied.detail}`;
    } else {
      notice = `${seat.name} gave no usable move — the engine moved instead`;
      thoughts = `rejected: ${result.reason}`;
    }
    // Grounding failed or the answer was unusable: the engine takes this ply so a
    // bad model answer cannot stall the game.
    if (opts.engine) await engineTurn();
  };

  const maybeAiMove = async (): Promise<void> => {
    const st = session.status();
    if (st.over) return;
    const seat = seatFor(st.turn);
    if (seat.kind === "human") return;
    thinking = true;
    render();
    try {
      if (seat.kind === "engine") await engineTurn();
      else await modelTurn(seat);
    } catch (err) {
      notice = err instanceof Error ? err.message : String(err);
    } finally {
      thinking = false;
      // The reply — or the failure that replaced it — only reaches the screen here.
      // Without this the board stays a move behind until the player touches a key.
      if (!finished) render();
    }
  };

  const tryMove = (from: string, to: string): void => {
    const options = session.legalMoves().filter((m) => m.from === from && m.to === to);
    if (!options.length) {
      notice = `${from}-${to} is not legal here`;
      return;
    }
    // A pawn reaching the last rank has four legal moves; queen is the default a
    // bare keypress can express.
    const chosen = options.find((m) => (m.promotion ?? "q") === "q") ?? options[0]!;
    const applied = session.move({ from: chosen.from, to: chosen.to, ...(chosen.promotion ? { promotion: chosen.promotion } : {}) });
    if (applied.ok) {
      notice = null;
      hints = [];
    } else notice = applied.detail;
  };

  const ARROWS: Record<string, [number, number]> = {
    up: [0, 1], k: [0, 1], down: [0, -1], j: [0, -1], left: [-1, 0], h: [-1, 0], right: [1, 0], l: [1, 0],
  };

  // `h` is vim-left, so the hint has to be the shifted key. Letter keys arrive
  // upper case when shifted, and a shift is never swallowed as a cursor move.
  const isHint = (key: Key) => key.type === "char" && (key.ch === "H" || (key.ch === "h" && key.shift));

  const handle = async (key: Key): Promise<void> => {
    if (key.type === "char" && key.ch === "q" && !key.ctrl) return quit();
    if (help) {
      help = false;
      return render();
    }
    if (key.type === "char" && key.ch === "?") {
      help = true;
      return render();
    }
    if (key.type === "special" && key.name === "escape") {
      selected = null;
      return render();
    }
    const delta = key.type === "special" ? ARROWS[key.name] : key.type === "char" && !key.shift ? ARROWS[key.ch] : undefined;
    if (delta) {
      cursor = { file: Math.min(7, Math.max(0, cursor.file + delta[0])), rank: Math.min(7, Math.max(0, cursor.rank + delta[1])) };
      return render();
    }
    const isSelect =
      (key.type === "special" && (key.name === "space" || key.name === "enter")) || (key.type === "char" && key.ch === " ");
    if (isSelect) {
      const here = squareName(cursor.file, cursor.rank);
      if (!selected) {
        selected = here;
        return render();
      }
      if (selected !== here) tryMove(selected, here);
      selected = null;
      render();
      return maybeAiMove();
    }
    if (key.type !== "char") return;

    const st = session.status();
    if (key.ch === "u") {
      session.takeback(2);
      notice = "took back a move";
      return render();
    }
    if (key.ch === "r") {
      if (!st.over) session.resign(st.turn);
      return render();
    }
    if (key.ch === "s") {
      const at = themes.findIndex((t) => t.key === theme.key);
      theme = themes[(at + 1) % themes.length]!;
      return render();
    }
    if (isHint(key)) {
      const candidates = await search();
      if (candidates?.[0]) {
        hints = [candidates[0].move];
        notice = `engine suggests ${candidates[0].move}`;
      }
      return render();
    }
    return render();
  };

  let resolveQuit: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveQuit = resolve;
  });
  function quit(): void {
    if (finished) return;
    finished = true;
    resolveQuit();
  }

  terminal.onKey((key) => void handle(key).catch((err) => {
    notice = err instanceof Error ? err.message : String(err);
    render();
  }));
  terminal.onResize(() => render());
  render();
  await maybeAiMove();
  render();
  await done;
}

const seatIsHuman = (opts: GameOptions, color: "w" | "b") =>
  (color === "w" ? opts.seatOf.white : opts.seatOf.black).kind === "human";

const statusLine = (opts: GameOptions, st: ReturnType<Session["status"]>): string => {
  if (st.over && st.outcome) {
    const who = st.outcome.winner ? sideName(st.outcome.winner) : null;
    return who ? `${who} wins by ${st.outcome.reason}` : `draw by ${st.outcome.reason}`;
  }
  const turn = sideName(st.turn);
  const mover = st.turn === "w" ? opts.labelOf.white : opts.labelOf.black;
  return `${turn} to move${st.check ? " — in check" : ""}${seatIsHuman(opts, st.turn) ? "" : ` (${mover})`}`;
};

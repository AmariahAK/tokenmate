import { z } from "zod";

export type Platform = "chess.com" | "lichess" | "file";

export type ImportedGame = {
  platform: Platform;
  /** Stable id where the platform gives one, else a slug of the date+players. */
  id: string;
  url: string | null;
  pgn: string;
  white: string;
  black: string;
  whiteElo: number | null;
  blackElo: number | null;
  result: string;
  /** chess.com exposes per-player accuracy on analysed games; lichess does not in PGN. */
  accuracies: { white: number | null; black: number | null } | null;
  date: string | null;
  timeClass: string | null;
};

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export const UA = "tokenmate (+https://github.com/AmariahAK/tokenmate)";

const strip = (s: string) => s.trim();

const header = (pgn: string, name: string) => {
  const m = new RegExp(`\\[${name} "([^"]*)"\\]`).exec(pgn);
  return m ? strip(m[1]!) : null;
};

const elo = (pgn: string, name: string) => {
  const v = header(pgn, name);
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Build a record from a PGN we already have, which is all a local file needs. */
export function fromPgn(pgn: string, platform: Platform = "file", url: string | null = null): ImportedGame {
  const date = header(pgn, "UTCDate") ?? header(pgn, "Date");
  const white = header(pgn, "White") ?? "White";
  const black = header(pgn, "Black") ?? "Black";
  return {
    platform,
    id: `${date ?? "?"}-${white}-${black}`.replace(/\s+/g, "_").toLowerCase(),
    url,
    pgn,
    white,
    black,
    whiteElo: elo(pgn, "WhiteElo"),
    blackElo: elo(pgn, "BlackElo"),
    result: header(pgn, "Result") ?? "*",
    accuracies: null,
    date,
    timeClass: header(pgn, "TimeControl"),
  };
}

// ---- chess.com -------------------------------------------------------------
// Public archives: no auth, no key. Verified against the live API.
const Archives = z.object({ archives: z.array(z.string()).default([]) });

const ChessComPlayer = z
  .object({ username: z.string().optional(), result: z.string().optional() })
  .passthrough();

const ChessComGame = z
  .object({
    url: z.string().optional(),
    pgn: z.string().optional(),
    time_class: z.string().optional(),
    end_time: z.number().optional(),
    white: ChessComPlayer.optional(),
    black: ChessComPlayer.optional(),
    accuracies: z.object({ white: z.number().optional(), black: z.number().optional() }).optional(),
  })
  .passthrough();

const ChessComMonth = z.object({ games: z.array(ChessComGame).default([]) });

export async function fetchChessCom(user: string, opts: { limit?: number; fetch?: Fetcher } = {}): Promise<ImportedGame[]> {
  const doFetch = opts.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const limit = Math.max(1, opts.limit ?? 10);
  const head = { headers: { "User-Agent": UA, Accept: "application/json" } };

  const archivesRes = await doFetch(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`, head);
  if (!archivesRes.ok) throw new Error(`chess.com returned ${archivesRes.status} for "${user}" — check the username`);
  const archives = Archives.parse(await archivesRes.json()).archives;
  if (!archives.length) return [];

  // Newest months first: walking from the start would download years of history
  // to produce ten games.
  const out: ImportedGame[] = [];
  for (const url of [...archives].reverse()) {
    if (out.length >= limit) break;
    const res = await doFetch(url, head);
    if (!res.ok) continue;
    const games = ChessComMonth.parse(await res.json()).games;
    for (const g of [...games].reverse()) {
      if (out.length >= limit) break;
      if (!g.pgn) continue;
      const rec = fromPgn(g.pgn, "chess.com", g.url ?? null);
      out.push({
        ...rec,
        timeClass: g.time_class ?? rec.timeClass,
        date: g.end_time ? new Date(g.end_time * 1000).toISOString().slice(0, 10) : rec.date,
        accuracies: g.accuracies
          ? { white: g.accuracies.white ?? null, black: g.accuracies.black ?? null }
          : null,
      });
    }
  }
  return out;
}

// ---- lichess ---------------------------------------------------------------
// The User-Agent is not optional: with no UA the endpoint answers 404, with a
// descriptive one it answers 200. Verified; do not "simplify" this header away.
export async function fetchLichess(user: string, opts: { limit?: number; fetch?: Fetcher } = {}): Promise<ImportedGame[]> {
  const doFetch = opts.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const limit = Math.max(1, opts.limit ?? 10);
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(user)}?max=${limit}&clocks=false&evals=false&opening=false`;
  const res = await doFetch(url, { headers: { "User-Agent": UA, Accept: "application/x-chess-pgn" } });
  if (res.status === 404) throw new Error(`lichess has no player "${user}" (or refused the request)`);
  if (!res.ok) throw new Error(`lichess returned ${res.status}`);
  return splitPgn(await res.text())
    .slice(0, limit)
    .map((pgn) => fromPgn(pgn, "lichess", header(pgn, "Site")));
}

/**
 * Split a multi-game PGN export. Games are separated by a blank line before the
 * next `[Event`, so the split has to be anchored on that rather than on any
 * blank line inside a game.
 */
export function splitPgn(text: string): string[] {
  const parts = text.replace(/\r\n/g, "\n").split(/\n(?=\[Event )/);
  return parts.map((p) => p.trim()).filter((p) => p.includes("[") && /\n\s*1\.|\{/.test(p));
}

export const readPgnFile = async (path: string): Promise<ImportedGame[]> => {
  const text = await Bun.file(path).text();
  const games = splitPgn(text);
  return (games.length ? games : [text]).map((g) => fromPgn(g));
};

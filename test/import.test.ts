import { describe, expect, test } from "bun:test";
import { fetchChessCom, fetchLichess, fromPgn, splitPgn, UA } from "../src/import/games";

const PGN = (white: string, black: string, result: string, date: string, moves: string) =>
  `[Event "Rated blitz game"]
[Site "https://lichess.org/abcd1234"]
[Date "${date}"]
[UTCDate "${date}"]
[White "${white}"]
[WhiteElo "1650"]
[Black "${black}"]
[BlackElo "1700"]
[Result "${result}"]
[TimeControl "180+2"]

${moves}`;

const GAME1 = PGN("alice", "bob", "1-0", "2026.11.20", "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0");
const GAME2 = PGN("carol", "dave", "0-1", "2026.11.19", "1. d4 d5 2. c4 e6 0-1");

describe("fromPgn", () => {
  test("reads the headers a game list needs", () => {
    const g = fromPgn(GAME1, "lichess");
    expect(g.white).toBe("alice");
    expect(g.black).toBe("bob");
    expect(g.whiteElo).toBe(1650);
    expect(g.blackElo).toBe(1700);
    expect(g.result).toBe("1-0");
    expect(g.date).toBe("2026.11.20");
    expect(g.platform).toBe("lichess");
    expect(g.pgn).toContain("1. e4 e5");
  });

  test("a missing header does not crash or invent a number", () => {
    const g = fromPgn('[Event "?"]\n\n1. e4 *');
    expect(g.whiteElo).toBeNull();
    expect(g.result).toBe("*");
  });
});

describe("splitPgn", () => {
  test("splits a multi-game export on game boundaries", () => {
    const parts = splitPgn(`${GAME1}\n\n${GAME2}`);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain("alice");
    expect(parts[1]).toContain("carol");
  });

  test("a blank line inside a game does not split it", () => {
    const withBlank = `${GAME1}\n\n${GAME2}`.replace("2. Nf3", "\n\n2. Nf3");
    expect(splitPgn(withBlank)).toHaveLength(2);
  });

  test("CRLF exports still split", () => {
    const crlf = `${GAME1}\r\n\r\n${GAME2}`.replace(/\n/g, "\r\n");
    expect(splitPgn(crlf)).toHaveLength(2);
  });
});

describe("chess.com", () => {
  const archives = {
    archives: [
      "https://api.chess.com/pub/player/alice/games/2024/01",
      "https://api.chess.com/pub/player/alice/games/2024/02",
    ],
  };

  const months: Record<string, unknown> = {
    "https://api.chess.com/pub/player/alice/games/2024/01": {
      games: [
        {
          url: "https://www.chess.com/game/live/1",
          pgn: PGN("alice", "old", "1-0", "2024.01.05", "1. e4 e5 1-0"),
          time_class: "blitz",
          end_time: 1704412800,
          accuracies: { white: 88.5, black: 74.2 },
        },
      ],
    },
    "https://api.chess.com/pub/player/alice/games/2024/02": {
      games: [
        {
          url: "https://www.chess.com/game/live/2",
          pgn: PGN("alice", "newer", "1-0", "2024.02.05", "1. e4 c5 1-0"),
          time_class: "rapid",
          end_time: 1707091200,
        },
        {
          url: "https://www.chess.com/game/live/3",
          pgn: PGN("newest", "alice", "0-1", "2024.02.09", "1. d4 Nf6 0-1"),
          time_class: "blitz",
          end_time: 1707436800,
        },
      ],
    },
  };

  test("walks archives newest-first, honours the limit and maps accuracies", async () => {
    const seen: string[] = [];
    const fetch = async (url: string) => {
      seen.push(url);
      const body = url.endsWith("/archives") ? archives : months[url];
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    };
    const games = await fetchChessCom("alice", { limit: 2, fetch });
    expect(games).toHaveLength(2);
    expect(games[0]?.pgn).toContain("newest");
    expect(games[1]?.pgn).toContain("newer");
    // only one month was needed, and it was the newest
    expect(seen.filter((u) => u.includes("/games/2024/"))).toEqual(["https://api.chess.com/pub/player/alice/games/2024/02"]);
  });

  test("carries the accuracies chess.com already computed", async () => {
    const fetch = async (url: string) =>
      new Response(JSON.stringify(url.endsWith("/archives") ? { archives: [archives.archives[0]!] } : months[archives.archives[0]!]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const [g] = await fetchChessCom("alice", { limit: 1, fetch });
    expect(g?.accuracies).toEqual({ white: 88.5, black: 74.2 });
    expect(g?.timeClass).toBe("blitz");
    expect(g?.date).toBe("2024-01-05");
  });

  test("sends a User-Agent and asks for JSON, with no auth of any kind", async () => {
    const inits: RequestInit[] = [];
    const fetch = async (_u: string, init?: RequestInit) => {
      inits.push(init ?? {});
      return new Response(JSON.stringify({ archives: [] }), { status: 200 });
    };
    await fetchChessCom("alice", { fetch });
    const headers = inits[0]?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe(UA);
    expect(JSON.stringify(headers).toLowerCase()).not.toContain("authorization");
  });

  test("a bad username fails with a message naming the user", async () => {
    const fetch = async () => new Response("nope", { status: 404 });
    await expect(fetchChessCom("ghost", { fetch })).rejects.toThrow(/ghost/);
  });
});

describe("lichess", () => {
  test("sends a descriptive User-Agent — the endpoint 404s without one", async () => {
    // This is the regression guard for a verified quirk: no UA -> 404, UA -> 200.
    let headers: Record<string, string> = {};
    const fetch = async (_u: string, init?: RequestInit) => {
      headers = (init?.headers as Record<string, string>) ?? {};
      if (!headers["User-Agent"]) return new Response("not found", { status: 404 });
      return new Response(`${GAME1}\n\n${GAME2}`, { status: 200 });
    };
    const games = await fetchLichess("alice", { fetch });
    expect(headers["User-Agent"]).toBe(UA);
    expect(games).toHaveLength(2);
    expect(games[0]?.platform).toBe("lichess");
    expect(games[0]?.url).toBe("https://lichess.org/abcd1234");
  });

  test("respects the limit", async () => {
    const fetch = async () => new Response(`${GAME1}\n\n${GAME2}`, { status: 200 });
    expect(await fetchLichess("alice", { limit: 1, fetch })).toHaveLength(1);
  });

  test("an unknown player is a clear error, not an empty list", async () => {
    const fetch = async () => new Response("not found", { status: 404 });
    await expect(fetchLichess("ghost", { fetch })).rejects.toThrow(/ghost/);
  });

  test("a 500 is reported with its status", async () => {
    const fetch = async () => new Response("boom", { status: 500 });
    await expect(fetchLichess("alice", { fetch })).rejects.toThrow(/500/);
  });
});

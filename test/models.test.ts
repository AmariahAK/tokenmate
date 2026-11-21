import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asciiBoard, askForMove, buildView, resolveChoice, userPrompt } from "../src/models/brain";
import { fetchCatalog, isFree, parseCatalog } from "../src/models/catalog";
import { discoverLocal } from "../src/models/local";
import { apiKeyFor, configPath, envVarFor, redact } from "../src/models/config";

let home = "";
const realHome = process.env["TOKENMATE_HOME"];

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "tokenmate-models-"));
  process.env["TOKENMATE_HOME"] = home;
});

afterEach(async () => {
  if (realHome === undefined) delete process.env["TOKENMATE_HOME"];
  else process.env["TOKENMATE_HOME"] = realHome;
  await rm(home, { recursive: true, force: true });
});

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

const CATALOGUE = {
  openai: {
    id: "openai",
    name: "OpenAI",
    models: {
      "gpt-5": { id: "gpt-5", name: "GPT-5", cost: { input: 3, output: 15 }, limit: { context: 400000 } },
      "gpt-5-mini": { id: "gpt-5-mini", name: "GPT-5 mini", cost: { input: 0, output: 0 }, limit: { context: 128000 } },
    },
  },
  empty: { id: "empty", name: "Empty", models: {} },
};

const FEN_START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const LEGAL = [
  { san: "e4", uci: "e2e4" },
  { san: "Nf3", uci: "g1f3" },
  { san: "d4", uci: "d2d4" },
];

describe("models.dev catalogue", () => {
  test("parses the provider map and drops providers with no models", () => {
    const providers = parseCatalog(JSON.stringify(CATALOGUE));
    expect(providers.map((p) => p.id)).toEqual(["openai"]);
    expect(providers[0]?.models.map((m) => m.id)).toEqual(["gpt-5", "gpt-5-mini"]);
    expect(providers[0]?.models.find((m) => m.id === "gpt-5-mini")?.cost).toEqual({ input: 0, output: 0 });
    expect(providers[0]?.models.find((m) => m.id === "gpt-5")?.context).toBe(400000);
  });

  test("accepts a models array as well as a keyed object", () => {
    const providers = parseCatalog(JSON.stringify({ x: { name: "X", models: [{ id: "a", name: "A" }] } }));
    expect(providers[0]?.models).toEqual([{ id: "a", name: "A", cost: null, context: null }]);
  });

  test("free means no stated price or both sides zero", () => {
    expect(isFree({ id: "a", name: "a", cost: { input: 0, output: 0 }, context: null })).toBe(true);
    expect(isFree({ id: "b", name: "b", cost: { input: 1, output: 0 }, context: null })).toBe(false);
  });

  test("rejects a body that is not a provider map", () => {
    expect(() => parseCatalog("null")).toThrow(/provider map/);
  });

  test("sends If-None-Match after the TTL and honours a 304", async () => {
    const calls: { headers: Record<string, string> }[] = [];
    let served = 0;
    const fetch = async (_u: string, init?: RequestInit) => {
      calls.push({ headers: (init?.headers as Record<string, string>) ?? {} });
      served++;
      if (served === 1) return json(CATALOGUE, { headers: { etag: 'W/"abc"' } });
      return new Response(null, { status: 304 });
    };

    const first = await fetchCatalog({ fetch, now: 1_000_000 });
    expect(first.providers).toHaveLength(1);
    expect(first.stale).toBe(false);

    // Inside the TTL the network is not touched at all.
    const cached = await fetchCatalog({ fetch, now: 1_000_000 + 60_000 });
    expect(cached.providers).toHaveLength(1);
    expect(served).toBe(1);

    const recheck = await fetchCatalog({ fetch, now: 1_000_000 + 2 * 60 * 60 * 1000 });
    expect(served).toBe(2);
    expect(calls[1]?.headers["If-None-Match"]).toBe('W/"abc"');
    expect(recheck.stale).toBe(false);
    expect(recheck.providers).toHaveLength(1);
  });

  test("falls back to a stale catalogue when the network fails", async () => {
    const ok = async () => json(CATALOGUE, { headers: { etag: "e" } });
    await fetchCatalog({ fetch: ok, now: 1 });
    const offline = async () => {
      throw new Error("offline");
    };
    const res = await fetchCatalog({ fetch: offline, now: 5 * 60 * 60 * 1000, force: true });
    expect(res.stale).toBe(true);
    expect(res.error).toContain("offline");
    expect(res.providers).toHaveLength(1);
  });

  test("reports an empty catalogue rather than throwing when there is no cache", async () => {
    const offline = async () => {
      throw new Error("offline");
    };
    const res = await fetchCatalog({ fetch: offline });
    expect(res.providers).toEqual([]);
    expect(res.stale).toBe(true);
  });
});

describe("local discovery", () => {
  test("finds Ollama and LM Studio on their default ports", async () => {
    const fetch = async (url: string) =>
      url.includes("11434")
        ? json({ models: [{ name: "llama3.2:3b" }, { name: "qwen2.5:7b" }] })
        : json({ data: [{ id: "lmstudio-community/qwen2.5-7b" }] });

    const d = await discoverLocal({ fetch });
    expect(d.providers.map((p) => p.id).sort()).toEqual(["lmstudio", "ollama"]);
    expect(d.providers.find((p) => p.id === "ollama")?.models.map((m) => m.id)).toEqual(["llama3.2:3b", "qwen2.5:7b"]);
    expect(d.missing).toEqual([]);
  });

  test("reports closed ports instead of throwing", async () => {
    const fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    const d = await discoverLocal({ fetch });
    expect(d.providers).toEqual([]);
    expect(d.missing.map((m) => m.id).sort()).toEqual(["lmstudio", "ollama"]);
    expect(d.missing[0]?.error).toContain("ECONNREFUSED");
  });

  test("a running port with the wrong shape is missing, not empty-successful", async () => {
    const fetch = async () => json({ nope: true });
    const d = await discoverLocal({ fetch });
    expect(d.providers).toEqual([]);
    expect(d.missing).toHaveLength(2);
  });

  test("a non-OK status is reported with the code", async () => {
    const fetch = async () => new Response("no", { status: 500 });
    const d = await discoverLocal({ fetch });
    expect(d.missing[0]?.error).toBe("HTTP 500");
  });
});

describe("grounded view", () => {
  test("the ASCII board places every piece on a named square", () => {
    const a = asciiBoard(FEN_START);
    const lines = a.split("\n");
    expect(lines).toHaveLength(9);
    expect(lines[0]?.startsWith("8 ")).toBe(true);
    // Black is lower case on ranks 8 and 7; white is upper case on ranks 1 and 2.
    expect(lines[0]?.match(/r/g)).toHaveLength(2);
    expect(lines[1]?.match(/\bp\b/g)).toHaveLength(8);
    expect(lines[6]?.match(/\bP\b/g)).toHaveLength(8);
    expect(lines[7]?.match(/R/g)).toHaveLength(2);
    expect(lines[8]).toBe("  a b c d e f g h");
  });

  test("white and black pieces are distinguishable — the whole point of the view", () => {
    // A model told "knight on c4" must be able to see whether it is its own.
    const white = asciiBoard("8/8/8/8/2N5/8/8/8 w - - 0 1");
    const black = asciiBoard("8/8/8/8/2n5/8/8/8 w - - 0 1");
    expect(white).not.toBe(black);
    expect(white).toContain("N");
    expect(black).toContain("n");
  });

  test("a4 sits under the a file once the labels are counted", () => {
    const lines = asciiBoard("8/8/8/8/p7/8/8/8 w - - 0 1").split("\n");
    // rank 4 is line index 4; the pawn is the first cell after "4 "
    expect(lines[4]).toBe("4 p . . . . . . .");
  });

  test("the prompt carries FEN, the board and the exact legal list", () => {
    const v = buildView({ fen: FEN_START, legal: LEGAL, history: ["1. e4 e5"], check: false });
    const p = userPrompt(v, "opponent");
    expect(p).toContain(FEN_START);
    expect(p).toContain("e4 (e2e4)");
    expect(p).toContain("Recent moves: 1. e4 e5");
    expect(p).toContain("Side to move: white");
    expect(userPrompt(buildView({ fen: FEN_START, legal: LEGAL, check: true }), "coach")).toContain("(in check)");
  });

  test("history keeps only the last three plies", () => {
    const v = buildView({ fen: FEN_START, legal: LEGAL, history: ["a", "b", "c", "d", "e"] });
    expect(v.history).toEqual(["c", "d", "e"]);
  });
});

describe("grounding: a model may only pick from our list", () => {
  test("accepts plain SAN and UCI", () => {
    expect(resolveChoice('{"move":"Nf3"}', LEGAL)?.uci).toBe("g1f3");
    expect(resolveChoice('{"move":"e2e4"}', LEGAL)?.uci).toBe("e2e4");
  });

  test("accepts a decorated SAN a model would actually emit", () => {
    expect(resolveChoice('{"move":"Nf3!?","comment":"develops"}', LEGAL)).toEqual({
      san: "Nf3",
      uci: "g1f3",
      comment: "develops",
    });
  });

  test("accepts JSON wrapped in prose or fences", () => {
    expect(resolveChoice('Sure!\n```json\n{"move": "d4"}\n```', LEGAL)?.san).toBe("d4");
  });

  test("REJECTS a legal-looking move that is not in our list", () => {
    // Nc3 is legal in chess, but it was not offered, so it must not pass.
    expect(resolveChoice('{"move":"Nc3"}', LEGAL)).toBeNull();
    expect(resolveChoice('{"move":"Qh5"}', LEGAL)).toBeNull();
  });

  test("rejects prose, empty and malformed replies", () => {
    expect(resolveChoice("I think you should play e4", LEGAL)).toBeNull();
    expect(resolveChoice('{"move":""}', LEGAL)).toBeNull();
    expect(resolveChoice("{}", LEGAL)).toBeNull();
  });
});

describe("askForMove", () => {
  test("returns the first grounded answer", async () => {
    const r = await askForMove(buildView({ fen: FEN_START, legal: LEGAL }), async () => '{"move":"e4"}');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.move.san).toBe("e4");
      expect(r.attempts).toBe(1);
    }
  });

  test("retries exactly once, then fails instead of guessing", async () => {
    let calls = 0;
    const r = await askForMove(buildView({ fen: FEN_START, legal: LEGAL }), async () => {
      calls++;
      return '{"move":"Qh5"}';
    });
    expect(calls).toBe(2);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.attempts).toBe(2);
      expect(r.reason).toContain("not in the legal list");
      expect(r.raw).toHaveLength(2);
    }
  });

  test("a bad first answer followed by a good one succeeds on attempt 2", async () => {
    let n = 0;
    const r = await askForMove(buildView({ fen: FEN_START, legal: LEGAL }), async () => (++n === 1 ? "nope" : '{"move":"d4"}'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.attempts).toBe(2);
  });

  test("a throwing or timing-out model becomes a reason, not an exception", async () => {
    const r = await askForMove(buildView({ fen: FEN_START, legal: LEGAL }), async () => {
      throw new Error("model timed out");
    }, { attempts: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("timed out");
  });
});

describe("keys", () => {
  test("local providers need no key and no env var", async () => {
    expect(await apiKeyFor("ollama")).toEqual({ key: null, source: "none", envVar: null });
    expect(await apiKeyFor("lmstudio")).toEqual({ key: null, source: "none", envVar: null });
  });

  test("reads the provider's documented env var", async () => {
    const key = "sk-test-key-value-123";
    process.env["OPENAI_API_KEY"] = key;
    try {
      const r = await apiKeyFor("openai");
      expect(r).toEqual({ key, source: "env", envVar: "OPENAI_API_KEY" });
    } finally {
      delete process.env["OPENAI_API_KEY"];
    }
  });

  test("falls back to a 0600 config file, and refuses a group-readable one", async () => {
    await writeFile(configPath(), JSON.stringify({ keys: { openai: "from-file" } }), { mode: 0o600 });
    expect((await apiKeyFor("openai")).source).toBe("file");

    await chmod(configPath(), 0o644);
    // The loose file is not silently trusted, but an absent env var must not throw.
    const r = await apiKeyFor("openai");
    expect(r.source).toBe("none");
  });

  test("redact never prints a usable key", () => {
    expect(redact("sk-abcdefghijklmnop")).toBe("sk-…op");
    expect(redact("short")).toBe("****");
    expect(redact(null)).toBe("(none)");
  });

  test("env var names are conventional", () => {
    expect(envVarFor("openai")).toBe("OPENAI_API_KEY");
    expect(envVarFor("some-new")).toBe("SOME_NEW_API_KEY");
  });
});

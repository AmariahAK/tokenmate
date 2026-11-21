import { readCache, writeCache } from "../util/cache";

export type CatalogModel = {
  id: string;
  name: string;
  /** USD per million tokens, when the catalogue states a price. */
  cost: { input: number; output: number } | null;
  context: number | null;
};

export type CatalogProvider = {
  id: string;
  name: string;
  /** OpenAI-compatible base URL when models.dev states one; null means we must
   *  know the provider by name or refuse it honestly. */
  api: string | null;
  models: CatalogModel[];
};

export type Catalog = {
  providers: CatalogProvider[];
  fetchedAt: number;
  /** True when this came from disk because the network or the server said no. */
  stale: boolean;
  /** Present when a refresh was attempted and failed. */
  error?: string;
};

const ENDPOINT = "https://models.dev/api.json";
const CACHE = "models-dev.json";
const TTL_MS = 60 * 60 * 1000;

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// models.dev serves a provider map whose `models` has been both an object keyed
// by id and an array over its lifetime, so both are accepted rather than
// breaking the app the day upstream reshapes it.
function normaliseModels(raw: unknown): CatalogModel[] {
  const entries = Array.isArray(raw)
    ? raw.map((m) => [undefined, m] as const)
    : raw && typeof raw === "object"
      ? Object.entries(raw as Record<string, unknown>)
      : [];
  const out: CatalogModel[] = [];
  for (const [key, value] of entries) {
    if (!value || typeof value !== "object") continue;
    const m = value as Record<string, unknown>;
    const id = typeof m["id"] === "string" ? m["id"] : key;
    if (!id) continue;
    const cost = m["cost"] as Record<string, unknown> | undefined;
    const limit = m["limit"] as Record<string, unknown> | undefined;
    out.push({
      id,
      name: typeof m["name"] === "string" ? m["name"] : id,
      cost: cost ? { input: num(cost["input"]) ?? 0, output: num(cost["output"]) ?? 0 } : null,
      context: limit ? num(limit["context"]) : null,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function parseCatalog(body: string): CatalogProvider[] {
  const data = JSON.parse(body) as unknown;
  if (!data || typeof data !== "object") throw new Error("models.dev returned something that is not a provider map");
  const out: CatalogProvider[] = [];
  for (const [id, value] of Object.entries(data as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const p = value as Record<string, unknown>;
    const models = normaliseModels(p["models"]);
    // A provider with no models cannot be chosen from, so it is not a choice.
    if (!models.length) continue;
    out.push({
      id,
      name: typeof p["name"] === "string" ? p["name"] : id,
      api: typeof p["api"] === "string" ? p["api"] : null,
      models,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The catalogue costs nothing to keep fresh: models.dev serves a strong ETag, so
 * an hourly recheck usually resolves to a 304 and re-reads the bytes we already
 * have. Offline is not an error either — a stale catalogue still lists models.
 */
export async function fetchCatalog(opts: { force?: boolean; fetch?: Fetcher; now?: number } = {}): Promise<Catalog> {
  const doFetch = opts.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const now = opts.now ?? Date.now();
  const cached = await readCache(CACHE);

  if (cached && !opts.force && now - cached.fetchedAt < TTL_MS) {
    try {
      return { providers: parseCatalog(cached.body), fetchedAt: cached.fetchedAt, stale: false };
    } catch {
      // fall through and refetch — a corrupt cache is the one case worth retrying now
    }
  }

  try {
    const headers: Record<string, string> = { "User-Agent": "tokenmate (+https://github.com/AmariahAK/tokenmate)" };
    if (cached?.etag) headers["If-None-Match"] = cached.etag;
    const res = await doFetch(ENDPOINT, { headers });
    if (res.status === 304 && cached) {
      await writeCache(CACHE, { ...cached, fetchedAt: now });
      return { providers: parseCatalog(cached.body), fetchedAt: now, stale: false };
    }
    if (!res.ok) throw new Error(`models.dev responded ${res.status}`);
    const body = await res.text();
    const providers = parseCatalog(body);
    await writeCache(CACHE, { body, etag: res.headers.get("etag") ?? undefined, fetchedAt: now });
    return { providers, fetchedAt: now, stale: false };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (cached) {
      try {
        return { providers: parseCatalog(cached.body), fetchedAt: cached.fetchedAt, stale: true, error };
      } catch {
        // cached bytes are unusable too; report the empty catalogue honestly
      }
    }
    return { providers: [], fetchedAt: now, stale: true, error };
  }
}

/** Free models are the ones worth surfacing first: tokenmate should work at zero cost. */
export const isFree = (m: CatalogModel) => !m.cost || (m.cost.input === 0 && m.cost.output === 0);

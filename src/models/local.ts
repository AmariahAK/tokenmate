import { z } from "zod";

export type LocalModel = { id: string; name: string };

export type LocalProvider = {
  id: "ollama" | "lmstudio";
  name: string;
  baseUrl: string;
  models: LocalModel[];
};

export type LocalDiscovery = {
  providers: LocalProvider[];
  /** Probes that found nothing, so the UI can say "Ollama is not running". */
  missing: { id: LocalProvider["id"]; baseUrl: string; error?: string }[];
};

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const PROBE_TIMEOUT_MS = 1200;

// models.dev carries neither of these: `lmstudio` is a three-model stub and
// `ollama` is absent entirely, because both serve whatever the user has pulled.
// So the only honest catalogue is the one running on this machine.
const TARGETS: { id: LocalProvider["id"]; name: string; baseUrl: string; path: string }[] = [
  { id: "ollama", name: "Ollama", baseUrl: "http://127.0.0.1:11434", path: "/api/tags" },
  { id: "lmstudio", name: "LM Studio", baseUrl: "http://127.0.0.1:1234", path: "/v1/models" },
];

const OllamaTags = z.object({ models: z.array(z.object({ name: z.string() }).passthrough()).default([]) });
const OpenAiModels = z.object({ data: z.array(z.object({ id: z.string() }).passthrough()).default([]) });

const parse = (id: LocalProvider["id"], body: unknown): LocalModel[] => {
  if (id === "ollama") {
    const r = OllamaTags.safeParse(body);
    return r.success ? r.data.models.map((m) => ({ id: m.name, name: m.name })) : [];
  }
  const r = OpenAiModels.safeParse(body);
  return r.success ? r.data.data.map((m) => ({ id: m.id, name: m.id })) : [];
};

/**
 * Discovery never throws and never blocks boot for long: a machine with no
 * local models is the common case, not a failure, so each probe gets its own
 * short deadline and the result says which port stayed quiet.
 */
export async function discoverLocal(opts: { fetch?: Fetcher; timeoutMs?: number } = {}): Promise<LocalDiscovery> {
  const doFetch = opts.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const timeout = opts.timeoutMs ?? PROBE_TIMEOUT_MS;

  const probed = await Promise.all(
    TARGETS.map(async (t) => {
      try {
        const res = await doFetch(t.baseUrl + t.path, { signal: AbortSignal.timeout(timeout) });
        if (!res.ok) return { ...t, models: [] as LocalModel[], error: `HTTP ${res.status}` };
        return { ...t, models: parse(t.id, await res.json()), error: undefined as string | undefined };
      } catch (err) {
        return { ...t, models: [] as LocalModel[], error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  const providers: LocalProvider[] = [];
  const missing: LocalDiscovery["missing"] = [];
  for (const p of probed) {
    if (p.models.length) providers.push({ id: p.id, name: p.name, baseUrl: p.baseUrl, models: p.models });
    else missing.push({ id: p.id, baseUrl: p.baseUrl, error: p.error });
  }
  return { providers, missing };
}

/** Every string a user could plausibly type for a local model, for lookup. */
export const localModelIds = (d: LocalDiscovery) => d.providers.flatMap((p) => p.models.map((m) => `${p.id}/${m.id}`));

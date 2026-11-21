import type { ChatFn } from "./brain";

/**
 * A model seat is a `ChatFn`: transport in, text out. Everything about *chess* is
 * in `brain.ts`; everything about HTTP is here, so grounding can be tested with no
 * network and this can be tested with no board.
 */

/** Providers whose API is not OpenAI-shaped. Named so the refusal is specific. */
const NOT_OPENAI_COMPATIBLE: Record<string, string> = {
  anthropic:
    "Anthropic's API is not OpenAI-compatible (it uses /v1/messages). Use an OpenAI-compatible provider, or OpenRouter, which fronts Anthropic models.",
  google: "Google's native API is not OpenAI-compatible; models.dev lists an OpenAI-compatible endpoint at /v1beta/openai, which tokenmate uses when the catalogue provides it.",
};

/**
 * Bases we know by name. Local providers are first because they are the
 * zero-config path: models.dev carries neither, so the address is ours to know.
 */
const KNOWN_BASE: Record<string, string> = {
  ollama: "http://127.0.0.1:11434/v1",
  lmstudio: "http://127.0.0.1:1234/v1",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1",
  deepseek: "https://api.deepseek.com/v1",
  mistral: "https://api.mistral.ai/v1",
  xai: "https://api.x.ai/v1",
  together: "https://api.together.xyz/v1",
  cerebras: "https://api.cerebras.ai/v1",
};

/** `provider/model`, split on the first slash so model ids may contain slashes. */
export function splitRef(ref: string): { provider: string; model: string } {
  const at = ref.indexOf("/");
  if (at <= 0 || at === ref.length - 1) throw new Error(`--model must look like provider/model (got "${ref}")`);
  return { provider: ref.slice(0, at), model: ref.slice(at + 1) };
}

export function baseUrlFor(providerId: string, declared: string | null): string | null {
  if (declared) return declared.replace(/\/+$/, "");
  return KNOWN_BASE[providerId] ?? null;
}

export type ChatDeps = {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  baseUrl?: string | null;
};

export type ChatSpec = {
  providerId: string;
  providerName: string;
  model: string;
  key: string | null;
  /** From the catalogue when it states one. */
  declaredApi?: string | null;
  /** Cap on the reply. A move is a few tokens; anything longer is a model rambling. */
  maxTokens?: number;
  timeoutMs?: number;
};

export class ChatConfigError extends Error {}

/**
 * Builds the transport. Two failure modes are refused before any request is made:
 * a provider we cannot address, and a provider that needs a key we do not have.
 * Local providers are exempt from the second, which is why they are the quick path.
 */
export function makeChat(spec: ChatSpec, deps: ChatDeps = {}): ChatFn {
  const refusal = NOT_OPENAI_COMPATIBLE[spec.providerId];
  if (refusal) throw new ChatConfigError(refusal);

  const base = baseUrlFor(spec.providerId, deps.baseUrl ?? spec.declaredApi ?? null);
  if (!base) {
    throw new ChatConfigError(
      `no address known for provider "${spec.providerId}". models.dev did not list one — run \`tokenmate doctor\` after refreshing, or use an OpenAI-compatible provider.`,
    );
  }

  const isLocal = spec.providerId === "ollama" || spec.providerId === "lmstudio";
  if (!isLocal && !spec.key) {
    throw new ChatConfigError(
      `${spec.providerName} needs an API key. Set ${envName(spec.providerId)} or add it to ~/.config/tokenmate/config.json (chmod 600).`,
    );
  }

  const doFetch = deps.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const maxTokens = spec.maxTokens ?? 64;
  const timeoutMs = spec.timeoutMs ?? 30_000;

  return async (messages, signal) => {
    // The caller's abort (a timeout) and ours (a stuck socket) both must work.
    const combined = signal ?? AbortSignal.timeout(timeoutMs);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (spec.key) headers.authorization = `Bearer ${spec.key}`;

    const res = await doFetch(`${base}/chat/completions`, {
      method: "POST",
      headers,
      signal: combined,
      body: JSON.stringify({
        model: spec.model,
        messages,
        // Zero temperature: a chess move should not be a creative act, and the
        // same position on the same model should not answer differently each ply.
        temperature: 0,
        max_tokens: maxTokens,
      }),
    });

    if (!res.ok) {
      // Never include the request, because it carries the Authorization header.
      const detail = await res.text().catch(() => "");
      const trimmed = detail.replace(/\s+/g, " ").slice(0, 200);
      throw new Error(`${spec.providerName} responded ${res.status}${trimmed ? `: ${trimmed}` : ""}`);
    }

    const body = (await res.json()) as {
      choices?: { message?: { content?: unknown } }[];
      error?: { message?: unknown };
    };
    if (body.error) throw new Error(`${spec.providerName}: ${String(body.error.message ?? "unknown error")}`);
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error(`${spec.providerName} returned no message content`);
    return content;
  };
}

/** Mirrors `config.ts`'s rule so the error message names the variable to set. */
const envName = (providerId: string) => `${providerId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;

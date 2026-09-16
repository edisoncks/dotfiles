// Rate limiting, caching, circuit breaking, request dedup, and shared
// formatting helpers. Depends only on lib/types.js and the pi host package.
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { REQUEST_TIMEOUT_MS } from "./types.js";
import type {
  DuckDuckGoState,
  NormalizedSearchParams,
  ProviderSearchResult,
  WebSearchResult,
} from "./types.js";

export const DDG_MIN_PAUSE_MS = 3_000;
export const DDG_JITTER_MS = 1_000;
export const DDG_CACHE_TTL_MS = 10 * 60_000;
export const DDG_CACHE_MAX_ENTRIES = 64;
export const DDG_COOLDOWN_MS = 10 * 60_000;
export const DDG_MAX_COOLDOWN_MS = 15 * 60_000;

export class DuckDuckGoUnavailableError extends Error {
  constructor(
    message: string,
    readonly retryAt: number,
  ) {
    super(message);
    this.name = "DuckDuckGoUnavailableError";
  }
}

export class DuckDuckGoDriftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuckDuckGoDriftError";
  }
}

export function createDuckDuckGoState(): DuckDuckGoState {
  return {
    requestQueue: Promise.resolve(),
    nextRequestAt: 0,
    unavailableUntil: 0,
    cache: new Map(),
    inFlight: new Map(),
  };
}

export function getRequestSignal(signal: AbortSignal | undefined): AbortSignal {
  if (
    typeof AbortSignal.timeout !== "function" ||
    typeof (AbortSignal as unknown as { any?: unknown }).any !== "function"
  ) {
    throw new Error(
      "pi-web-search requires Node >=20.3 (AbortSignal.timeout/any missing)"
    );
  }
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export function shortErrorMessage(error: unknown): string {
  return errorMessage(error).replace(/\s+/gu, " ").slice(0, 300);
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

export function waitWithSignal(ms: number, signal: AbortSignal | undefined): Promise<void> {
  throwIfAborted(signal);
  if (ms <= 0) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(signal?.reason ?? new DOMException("The operation was aborted", "AbortError"));
    };

    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

export function waitForPromiseWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return promise;

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);

    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

export function randomJitter(maxMs: number): number {
  return Math.floor(Math.random() * (maxMs + 1));
}

export function clampCooldown(delayMs: number): number {
  return Math.min(Math.max(delayMs, DDG_COOLDOWN_MS), DDG_MAX_COOLDOWN_MS);
}

export function markDuckDuckGoUnavailable(
  state: DuckDuckGoState,
  delayMs = DDG_COOLDOWN_MS,
): number {
  const retryAt = Date.now() + clampCooldown(delayMs);
  state.unavailableUntil = Math.max(state.unavailableUntil, retryAt);
  return state.unavailableUntil;
}

export function createCircuitOpenError(state: DuckDuckGoState): DuckDuckGoUnavailableError {
  const retryAt = state.unavailableUntil;
  const seconds = Math.max(1, Math.ceil((retryAt - Date.now()) / 1_000));
  return new DuckDuckGoUnavailableError(
    `DuckDuckGo is temporarily unavailable; retry in about ${seconds}s`,
    retryAt,
  );
}

export async function withDuckDuckGoRequestSlot<T>(
  state: DuckDuckGoState,
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = state.requestQueue;
  let release!: () => void;
  state.requestQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  try {
    await waitForPromiseWithSignal(previous, signal);
    throwIfAborted(signal);
    if (state.unavailableUntil > Date.now()) {
      throw createCircuitOpenError(state);
    }

    const spacing = Math.max(0, state.nextRequestAt - Date.now());
    await waitWithSignal(spacing, signal);
    throwIfAborted(signal);

    const result = await operation();
    // Spacing penalty applies to completed attempts only. Deterministic
    // failures (drift/challenge/abort) fail fast with no penalty; the
    // circuit breaker owns cooldowns for rate-limit cases.
    state.nextRequestAt =
      Date.now() + DDG_MIN_PAUSE_MS + randomJitter(DDG_JITTER_MS);
    return result;
  } finally {
    release();
  }
}

export function isRetryableDuckDuckGoError(error: unknown): boolean {
  if (error instanceof DuckDuckGoUnavailableError) return false;
  if (error instanceof DuckDuckGoDriftError) return false;
  if (error instanceof DOMException && error.name === "AbortError") return false;
  return true;
}

export function getDuckDuckGoCacheKey(params: NormalizedSearchParams): string {
  return JSON.stringify({
    query: params.query,
    allowedDomains: params.allowedDomains,
    blockedDomains: params.blockedDomains,
    numResults: params.numResults,
  });
}

export function getCachedDuckDuckGoResult(
  state: DuckDuckGoState,
  key: string,
): ProviderSearchResult | undefined {
  const entry = state.cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    state.cache.delete(key);
    return undefined;
  }
  return entry.result;
}

export function cacheDuckDuckGoResult(
  state: DuckDuckGoState,
  key: string,
  result: ProviderSearchResult,
): void {
  const now = Date.now();
  for (const [entryKey, entry] of state.cache) {
    if (entry.expiresAt <= now) state.cache.delete(entryKey);
  }

  state.cache.delete(key);
  state.cache.set(key, {
    result,
    expiresAt: now + DDG_CACHE_TTL_MS,
  });

  while (state.cache.size > DDG_CACHE_MAX_ENTRIES) {
    const oldestKey = state.cache.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    state.cache.delete(oldestKey);
  }
}

export function formatNumberedResults(provider: string, results: WebSearchResult[]): string {
  if (results.length === 0) return `No web search results found (provider: ${provider}).`;

  const entries = results.map((result, index) => {
    const lines = [`${index + 1}. ${result.title}`, `   URL: ${result.url}`];
    if (result.snippet) lines.push(`   ${result.snippet}`);
    return lines.join("\n");
  });

  return [`Web search results (provider: ${provider}):`, ...entries].join("\n\n");
}

export function truncateSearchOutput(text: string): string {
  const truncation = truncateHead(text, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });

  if (!truncation.truncated) return truncation.content;

  return `${truncation.content}\n\n[Search output truncated by pi; reduce numResults or narrow the domain filters.]`;
}

export function formatSearchToolResult(
  provider: string,
  result: ProviderSearchResult,
): { content: [{ type: "text"; text: string }]; details: { provider: string; resultCount: number } } {
  return {
    content: [{ type: "text", text: truncateSearchOutput(result.text) }],
    details: {
      provider,
      resultCount: result.resultCount,
    },
  };
}

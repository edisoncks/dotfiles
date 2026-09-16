import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  DEFAULT_NUM_RESULTS,
  MAX_NUM_RESULTS,
  MIN_QUERY_LENGTH,
  REQUEST_TIMEOUT_MS,
  isRecord,
  type DuckDuckGoCacheEntry,
  type DuckDuckGoState,
  type ExaStructuredResult,
  type McpRpcResponse,
  type McpToolResult,
  type NormalizedSearchParams,
  type ProviderSearchResult,
  type WebSearchParams,
  type WebSearchResult,
  type DuckDuckGoClassification,
} from "./lib/types.js";

export type {
  DuckDuckGoCacheEntry,
  DuckDuckGoState,
  ExaStructuredResult,
  McpRpcResponse,
  McpToolResult,
  NormalizedSearchParams,
  ProviderSearchResult,
  WebSearchParams,
  WebSearchResult,
} from "./lib/types.js";

const execFileAsync = promisify(execFile);

const DDG_MIN_PAUSE_MS = 3_000;
const DDG_JITTER_MS = 1_000;
const DDG_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const OBSCURA_COMMAND = "obscura";
const DDG_CACHE_TTL_MS = 10 * 60_000;
const DDG_CACHE_MAX_ENTRIES = 64;
const DDG_COOLDOWN_MS = 10 * 60_000;
const DDG_MAX_COOLDOWN_MS = 15 * 60_000;
const DDG_MAX_RETRIES = 1;
const DDG_RETRY_BASE_MS = 1_000;
const DUCKDUCKGO_URL = "https://lite.duckduckgo.com/lite";
const EXA_MCP_URL = "https://mcp.exa.ai/mcp";

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

import {
  normalizeDomain,
  normalizeDomains,
  hostnameOf,
  isDomainMatch,
} from "./lib/filter.js";

export {
  normalizeDomain,
  normalizeDomains,
  hostnameOf,
  isDomainMatch,
} from "./lib/filter.js";

function normalizeSearchParams(params: WebSearchParams): NormalizedSearchParams {
  const query = params.query.trim();
  if (query.length < MIN_QUERY_LENGTH) {
    throw new Error(`Search query must be at least ${MIN_QUERY_LENGTH} characters long`);
  }

  const numResults = params.numResults ?? DEFAULT_NUM_RESULTS;
  if (!Number.isInteger(numResults) || numResults < 1 || numResults > MAX_NUM_RESULTS) {
    throw new Error(`numResults must be an integer between 1 and ${MAX_NUM_RESULTS}`);
  }

  return {
    query,
    allowedDomains: normalizeDomains(params.allowed_domains),
    blockedDomains: normalizeDomains(params.blocked_domains),
    numResults,
  };
}

function getRequestSignal(signal: AbortSignal | undefined): AbortSignal {
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

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function shortErrorMessage(error: unknown): string {
  return errorMessage(error).replace(/\s+/gu, " ").slice(0, 300);
}

function isExaQuotaOrRateLimitError(error: unknown): boolean {
  return /quota|rate.?limit|too many requests|http\s*429|usage limit|exceeded/iu.test(
    errorMessage(error),
  );
}

export function createExaSearchError(error: unknown): Error {
  const detail = shortErrorMessage(error);
  // Warn-and-try per design: anonymous use may work, so only hint at the
  // key when the server actually rejected auth.
  if (/http\s*40[13]/iu.test(detail)) {
    return new Error(
      `Exa web search is unavailable (${detail}). Set EXA_API_KEY to use Exa, or call web_search_ddg for this search instead; do not retry web_search_exa immediately.`
    );
  }
  const reason = isExaQuotaOrRateLimitError(error)
    ? "Exa quota or rate limit was reached"
    : "Exa web search is unavailable";
  return new Error(
    `${reason} (${detail}). Call web_search_ddg for this search instead; do not retry web_search_exa immediately.`,
  );
}

export function createDuckDuckGoSearchError(error: unknown): Error {
  if (/spawn obscura ENOENT|ENOENT.*obscura|obscura.*not found/iu.test(errorMessage(error))) {
    return new Error(
      `obscura not found on PATH (required for web_search_ddg); install obscura or use web_search_exa instead. (${shortErrorMessage(error)})`
    );
  }
  return new Error(
    `DuckDuckGo web search is unavailable (${shortErrorMessage(error)}). Use web_search_exa if it has not already failed; do not retry DuckDuckGo immediately.`,
  );
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

function waitWithSignal(ms: number, signal: AbortSignal | undefined): Promise<void> {
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

function randomJitter(maxMs: number): number {
  return Math.floor(Math.random() * (maxMs + 1));
}

function clampCooldown(delayMs: number): number {
  return Math.min(Math.max(delayMs, DDG_COOLDOWN_MS), DDG_MAX_COOLDOWN_MS);
}

function markDuckDuckGoUnavailable(
  state: DuckDuckGoState,
  delayMs = DDG_COOLDOWN_MS,
): number {
  const retryAt = Date.now() + clampCooldown(delayMs);
  state.unavailableUntil = Math.max(state.unavailableUntil, retryAt);
  return state.unavailableUntil;
}

function createCircuitOpenError(state: DuckDuckGoState): DuckDuckGoUnavailableError {
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

export function detectDuckDuckGoChallenge(html: string): string | undefined {
  // Structural markers only. Callers gate this on zero parsed results so that
  // snippet text (e.g. a search about "HTTP 429") can never trip the breaker.
  if (/challenge-form|anomaly|captcha|Unfortunately, bots use DuckDuckGo/iu.test(html)) {
    return "DuckDuckGo returned an anti-bot challenge page";
  }
  return undefined;
}

export function isRetryableDuckDuckGoError(error: unknown): boolean {
  if (error instanceof DuckDuckGoUnavailableError) return false;
  if (error instanceof DuckDuckGoDriftError) return false;
  if (error instanceof DOMException && error.name === "AbortError") return false;
  return true;
}

function getDuckDuckGoCacheKey(params: NormalizedSearchParams): string {
  return JSON.stringify({
    query: params.query,
    allowedDomains: params.allowedDomains,
    blockedDomains: params.blockedDomains,
    numResults: params.numResults,
  });
}

function getCachedDuckDuckGoResult(
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

function cacheDuckDuckGoResult(
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

export function parseSsePayload(body: string): unknown {
  const blocks = body.split(/\r?\n\r?\n/u);
  const candidates: string[] = [];

  for (const block of blocks) {
    const data = block
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).replace(/^ /u, ""))
      .join("\n")
      .trim();

    if (data) candidates.push(data);
  }

  for (const candidate of candidates.reverse()) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Ignore non-JSON SSE events and continue looking for the JSON-RPC event.
    }
  }

  throw new Error("Exa MCP returned an invalid SSE response");
}

export function parseMcpResponse(body: string, contentType: string | null = null): McpRpcResponse {
  const trimmed = body.trim();
  if (!trimmed) return {};

  const looksSSE =
    /text\/event-stream/iu.test(contentType ?? "") ||
    /^(event|data):/mu.test(trimmed);

  let payload: unknown;
  if (!looksSSE) {
    try {
      payload = JSON.parse(trimmed) as unknown;
    } catch (jsonError) {
      try {
        payload = parseSsePayload(trimmed);
      } catch {
        throw new Error(
          `Exa MCP response parsed neither as JSON (as JSON: ${shortErrorMessage(jsonError)}) nor as SSE fallback`
        );
      }
    }
  } else {
    try {
      payload = parseSsePayload(trimmed);
    } catch (sseError) {
      try {
        payload = JSON.parse(trimmed) as unknown;
      } catch {
        throw new Error(
          `Exa MCP response parsed neither as SSE (as SSE: ${shortErrorMessage(sseError)}) nor as JSON fallback`
        );
      }
    }
  }
  if (!isRecord(payload)) {
    throw new Error("Exa MCP returned an invalid JSON-RPC response");
  }
  return payload as McpRpcResponse;
}

async function postMcpRequest(
  url: string,
  payload: Record<string, unknown>,
  sessionId: string | undefined,
  signal: AbortSignal | undefined,
): Promise<{ response: McpRpcResponse; sessionId?: string }> {
  const headers: Record<string, string> = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    "x-exa-source": "pi-web-search",
  };
  const apiKey = process.env.EXA_API_KEY?.trim();
  if (apiKey) headers["x-api-key"] = apiKey;
  if (sessionId) {
    headers["Mcp-Session-Id"] = sessionId;
    headers["MCP-Protocol-Version"] = "2025-03-26";
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: getRequestSignal(signal),
  });
  const body = await response.text();

  if (!response.ok) {
    const suffix = body.trim() ? `: ${body.trim().slice(0, 300)}` : "";
    throw new Error(`Exa MCP returned HTTP ${response.status}${suffix}`);
  }

  return {
    response: parseMcpResponse(body, response.headers.get("content-type")),
    sessionId: response.headers.get("mcp-session-id") ?? sessionId,
  };
}

function mcpError(response: McpRpcResponse): Error | undefined {
  if (!response.error) return undefined;
  const code = response.error.code === undefined ? "" : ` (${response.error.code})`;
  return new Error(`Exa MCP error${code}: ${response.error.message ?? "unknown error"}`);
}

function textFromMcpResult(result: McpToolResult): string {
  const text = (result.content ?? [])
    .filter((item) => item.type === undefined || item.type === "text")
    .map((item) => item.text)
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .join("\n\n")
    .trim();

  if (text) return text;
  if (result.structuredContent !== undefined) {
    return JSON.stringify(result.structuredContent);
  }
  return "";
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === "string" && record[key] ? record[key] : undefined;
}

function readStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function compactText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function parseExaStructuredResults(rawText: string): ExaStructuredResult[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch {
    return undefined;
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.results)) return undefined;

  return parsed.results.flatMap((item): ExaStructuredResult[] => {
    if (!isRecord(item)) return [];

    const url = readString(item, "url");
    if (!url) return [];

    const highlights = readStringArray(item, "highlights");
    const snippet = compactText(
      readString(item, "summary") ??
        (highlights.length > 0 ? highlights.join(" ") : undefined) ??
        readString(item, "text") ??
        "",
    );

    return [
      {
        title: readString(item, "title") ?? url,
        url,
        snippet,
      },
    ];
  });
}

function formatNumberedResults(provider: string, results: WebSearchResult[]): string {
  if (results.length === 0) return `No web search results found (provider: ${provider}).`;

  const entries = results.map((result, index) => {
    const lines = [`${index + 1}. ${result.title}`, `   URL: ${result.url}`];
    if (result.snippet) lines.push(`   ${result.snippet}`);
    return lines.join("\n");
  });

  return [`Web search results (provider: ${provider}):`, ...entries].join("\n\n");
}

export function formatExaSearchResult(
  toolResult: McpToolResult,
  params: NormalizedSearchParams,
): ProviderSearchResult {
  if (toolResult.isError) {
    throw new Error(textFromMcpResult(toolResult) || "Exa MCP search failed");
  }

  const rawText = textFromMcpResult(toolResult);
  const structuredResults = parseExaStructuredResults(rawText);

  if (structuredResults) {
    const filteredResults = structuredResults
      .filter((result) => !isDomainMatch(result.url, params.blockedDomains))
      .filter(
        (result) =>
          params.allowedDomains.length === 0 || isDomainMatch(result.url, params.allowedDomains),
      )
      .slice(0, params.numResults);

    return {
      text: formatNumberedResults("Exa", filteredResults),
      resultCount: filteredResults.length,
    };
  }

  // Unstructured text cannot be counted reliably; report 0 rather than
  // guessing from body content (a snippet line starting with "Title:"
  // would inflate a /^Title:/ heuristic).
  return {
    text: rawText
      ? `Web search results (provider: Exa):\n\n${rawText}`
      : "No web search results found (provider: Exa).",
    resultCount: 0,
  };
}

async function searchExa(
  params: NormalizedSearchParams,
  signal: AbortSignal | undefined,
): Promise<ProviderSearchResult> {
  const useAdvancedTool =
    params.allowedDomains.length > 0 || params.blockedDomains.length > 0;
  const toolName = useAdvancedTool ? "web_search_advanced_exa" : "web_search_exa";
  const endpoint = new URL(EXA_MCP_URL);
  endpoint.searchParams.set("tools", toolName);

  const initialized = await postMcpRequest(
    endpoint.toString(),
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: {
          name: "pi-web-search",
          version: "1.0.0",
        },
      },
    },
    undefined,
    signal,
  );
  const initializeError = mcpError(initialized.response);
  if (initializeError) throw initializeError;

  const sessionId = initialized.sessionId;
  await postMcpRequest(
    endpoint.toString(),
    {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    },
    sessionId,
    signal,
  );

  const argumentsPayload: Record<string, unknown> = {
    query: params.query,
    numResults: params.numResults,
  };
  if (useAdvancedTool) {
    if (params.allowedDomains.length > 0) {
      argumentsPayload.includeDomains = params.allowedDomains;
    }
    if (params.blockedDomains.length > 0) {
      argumentsPayload.excludeDomains = params.blockedDomains;
    }
    argumentsPayload.textMaxCharacters = 1_000;
  }

  const called = await postMcpRequest(
    endpoint.toString(),
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: argumentsPayload,
      },
    },
    sessionId,
    signal,
  );
  const callError = mcpError(called.response);
  if (callError) throw callError;
  if (!called.response.result) {
    throw new Error("Exa MCP returned no tool result");
  }

  return formatExaSearchResult(called.response.result, params);
}

async function searchExaForTool(
  params: NormalizedSearchParams,
  signal: AbortSignal | undefined,
): Promise<ProviderSearchResult> {
  try {
    return await searchExa(params, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    throw createExaSearchError(error);
  }
}

function decodeHtmlEntities(value: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value
    .replace(/&#x([0-9a-f]+);/giu, (_match: string, hex: string) => {
      try {
        return String.fromCodePoint(Number.parseInt(hex, 16));
      } catch {
        return _match;
      }
    })
    .replace(/&#(\d+);/gu, (_match: string, decimal: string) => {
      try {
        return String.fromCodePoint(Number.parseInt(decimal, 10));
      } catch {
        return _match;
      }
    })
    .replace(/&([a-z]+);/giu, (match: string, name: string) => {
      return namedEntities[name.toLowerCase()] ?? match;
    });
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
      .replace(/<br\s*\/?>/giu, " ")
      .replace(/<[^>]*>/gu, " "),
  )
    .replace(/\s+/gu, " ")
    .trim();
}

export function resolveDuckDuckGoResultUrl(href: string): string | undefined {
  try {
    const link = new URL(decodeHtmlEntities(href), "https://duckduckgo.com");
    const dest = link.searchParams.get("uddg");
    if (!dest) {
      // Never surface duckduckgo.com navigation links as results.
      if (link.hostname.toLowerCase().endsWith("duckduckgo.com")) return undefined;
      if (link.protocol !== "http:" && link.protocol !== "https:") return undefined;
      return link.toString();
    }
    let target: URL;
    try {
      target = new URL(dest, "https://duckduckgo.com");
    } catch {
      return undefined;
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") return undefined;
    if (target.hostname.toLowerCase().endsWith("duckduckgo.com")) return undefined;
    return target.toString();
  } catch {
    return undefined;
  }
}

export function parseDuckDuckGoResults(
  html: string,
  allowedDomains: string[] = [],
  blockedDomains: string[] = [],
): WebSearchResult[] {
  const normalizedAllowedDomains = normalizeDomains(allowedDomains);
  const normalizedBlockedDomains = normalizeDomains(blockedDomains);
  const resultLinkPattern =
    /<a\b[^>]*\bclass\s*=\s*(['"])[^'"]*\bresult-link\b[^'"]*\1[^>]*>([\s\S]*?)<\/a>/giu;
  const matches = [...html.matchAll(resultLinkPattern)];
  const results: WebSearchResult[] = [];
  const seenUrls = new Set<string>();

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const hrefMatch = match[0].match(/\bhref\s*=\s*(['"])([\s\S]*?)\1/iu);
    const url = hrefMatch ? resolveDuckDuckGoResultUrl(hrefMatch[2]) : undefined;
    if (!url || seenUrls.has(url)) continue;

    const sectionStart = (match.index ?? 0) + match[0].length;
    const sectionEnd = matches[index + 1]?.index ?? html.length;
    const section = html.slice(sectionStart, sectionEnd);
    const snippetMatch = section.match(
      /<td\b[^>]*\bclass\s*=\s*(['"])[^'"]*\bresult-snippet\b[^'"]*\1[^>]*>([\s\S]*?)<\/td>/iu,
    );

    if (isDomainMatch(url, normalizedBlockedDomains)) continue;
    if (
      normalizedAllowedDomains.length > 0 &&
      !isDomainMatch(url, normalizedAllowedDomains)
    ) {
      continue;
    }

    seenUrls.add(url);
    results.push({
      title: stripHtml(match[2]),
      url,
      snippet: snippetMatch ? stripHtml(snippetMatch[2]) : "",
    });
  }

  return results;
}

export function classifyDuckDuckGoResponse(
  html: string,
  allowedDomains: string[] = [],
  blockedDomains: string[] = [],
): DuckDuckGoClassification {
  const results = parseDuckDuckGoResults(html, allowedDomains, blockedDomains);
  if (results.length > 0) return { kind: "results", results };

  const challenge = detectDuckDuckGoChallenge(html);
  if (challenge) return { kind: "challenge", reason: challenge };
  if (/uddg=/u.test(html)) return { kind: "drift" };
  return { kind: "empty" };
}

function buildDuckDuckGoQuery(params: NormalizedSearchParams): string {
  const queryParts = [params.query];

  if (params.allowedDomains.length > 0) {
    queryParts.push(
      `(${params.allowedDomains.map((domain) => `site:${domain}`).join(" OR ")})`,
    );
  }
  queryParts.push(...params.blockedDomains.map((domain) => `-site:${domain}`));

  return queryParts.join(" ");
}

async function fetchDuckDuckGoAttempt(
  params: NormalizedSearchParams,
  state: DuckDuckGoState,
  signal: AbortSignal | undefined,
): Promise<ProviderSearchResult> {
  const url = new URL(DUCKDUCKGO_URL);
  url.searchParams.set("q", buildDuckDuckGoQuery(params));

  const { stdout } = await execFileAsync(
    OBSCURA_COMMAND,
    [
      "--stealth",
      "fetch",
      url.toString(),
      "--dump",
      "html",
      "--quiet",
      "--wait",
      "0",
      "--timeout",
      String(Math.ceil(REQUEST_TIMEOUT_MS / 1_000)),
    ],
    {
      encoding: "utf8",
      maxBuffer: DDG_MAX_OUTPUT_BYTES,
      signal: getRequestSignal(signal),
      timeout: REQUEST_TIMEOUT_MS,
    },
  );
  const html = stdout;
  if (!html.trim()) {
    throw new Error("Obscura returned empty DuckDuckGo HTML");
  }

  const classification = classifyDuckDuckGoResponse(
    html,
    params.allowedDomains,
    params.blockedDomains,
  );

  if (classification.kind === "challenge") {
    const retryAt = markDuckDuckGoUnavailable(state);
    throw new DuckDuckGoUnavailableError(classification.reason, retryAt);
  }
  if (classification.kind === "drift") {
    // Deterministic: same markup will fail identically on retry. Fail fast
    // with no cooldown (this is not rate-limiting) and no retry.
    throw new DuckDuckGoDriftError(
      "DuckDuckGo returned results but none could be parsed; its markup likely changed. Use web_search_exa for this search.",
    );
  }

  const results =
    classification.kind === "results"
      ? classification.results.slice(0, params.numResults)
      : [];

  return {
    text: formatNumberedResults("DuckDuckGo", results),
    resultCount: results.length,
  };
}

async function fetchDuckDuckGoWithRetry(
  params: NormalizedSearchParams,
  state: DuckDuckGoState,
  signal: AbortSignal | undefined,
): Promise<ProviderSearchResult> {
  for (let attempt = 0; attempt <= DDG_MAX_RETRIES; attempt += 1) {
    try {
      return await withDuckDuckGoRequestSlot(state, signal, () =>
        fetchDuckDuckGoAttempt(params, state, signal),
      );
    } catch (error) {
      if (
        signal?.aborted ||
        attempt >= DDG_MAX_RETRIES ||
        !isRetryableDuckDuckGoError(error)
      ) {
        throw error;
      }

      await waitWithSignal(
        DDG_RETRY_BASE_MS * 2 ** attempt + randomJitter(DDG_JITTER_MS),
        signal,
      );
    }
  }

  throw new Error("DuckDuckGo request failed");
}

async function searchDuckDuckGo(
  params: NormalizedSearchParams,
  state: DuckDuckGoState,
  signal: AbortSignal | undefined,
): Promise<ProviderSearchResult> {
  const key = getDuckDuckGoCacheKey(params);
  const cached = getCachedDuckDuckGoResult(state, key);
  if (cached) return cached;

  const pending = state.inFlight.get(key);
  if (pending) return waitForPromiseWithSignal(pending, signal);

  // Shared work must not be tied to any single waiter's signal: the first
  // caller's abort must not reject co-waiters. Each waiter (including the
  // creator) applies its own signal only on the wait below.
  const request = fetchDuckDuckGoWithRetry(params, state, undefined);
  state.inFlight.set(key, request);

  try {
    const result = await waitForPromiseWithSignal(request, signal);
    cacheDuckDuckGoResult(state, key, result);
    return result;
  } finally {
    if (state.inFlight.get(key) === request) state.inFlight.delete(key);
  }
}

async function searchDuckDuckGoForTool(
  params: NormalizedSearchParams,
  state: DuckDuckGoState,
  signal: AbortSignal | undefined,
): Promise<ProviderSearchResult> {
  try {
    return await searchDuckDuckGo(params, state, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    throw createDuckDuckGoSearchError(error);
  }
}

function truncateSearchOutput(text: string): string {
  const truncation = truncateHead(text, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });

  if (!truncation.truncated) return truncation.content;

  return `${truncation.content}\n\n[Search output truncated by pi; reduce numResults or narrow the domain filters.]`;
}

function createSearchParameters() {
  return Type.Object({
    query: Type.String({
      minLength: MIN_QUERY_LENGTH,
      description: "Search query, at least two characters long",
    }),
    allowed_domains: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        description: "Only return results from these domains",
      }),
    ),
    blocked_domains: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        description: "Exclude results from these domains",
      }),
    ),
    numResults: Type.Optional(
      Type.Integer({
        default: DEFAULT_NUM_RESULTS,
        minimum: 1,
        maximum: MAX_NUM_RESULTS,
        description: "Maximum number of results to return (default: 8)",
      }),
    ),
  });
}

function formatSearchToolResult(
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

export default function (pi: ExtensionAPI) {
  const duckDuckGoState = createDuckDuckGoState();

  pi.registerTool({
    name: "web_search_exa",
    label: "Web Search (Exa)",
    description:
      "Primary web search provider. Use web_search_exa first for current information and relevant sources. If Exa reports a quota, rate-limit, or provider error, call web_search_ddg instead; do not retry Exa immediately.",
    promptSnippet: "Search the web with Exa as the primary provider",
    promptGuidelines: [
      "Use web_search_exa first when the user needs current information or web sources.",
      "If web_search_exa reports an error, call web_search_ddg instead of retrying Exa immediately.",
      "Do not call web_search_exa and web_search_ddg for the same query unless the user requests a comparison.",
    ],
    parameters: createSearchParameters(),
    async execute(_toolCallId, params, signal) {
      const normalizedParams = normalizeSearchParams(params);
      const result = await searchExaForTool(normalizedParams, signal);
      return formatSearchToolResult("exa", result);
    },
  });

  pi.registerTool({
    name: "web_search_ddg",
    label: "Web Search (DuckDuckGo)",
    description:
      "Fallback web search provider using DuckDuckGo Lite through Obscura. Only use web_search_ddg when web_search_exa reports an error or when the user explicitly requests DuckDuckGo. Do not use it for routine searches while Exa is available.",
    promptSnippet: "Search the web with DuckDuckGo only after Exa fails",
    promptGuidelines: [
      "Use web_search_ddg only after web_search_exa reports an error or when the user explicitly requests DuckDuckGo.",
      "Do not use web_search_ddg as the first provider for routine searches.",
    ],
    parameters: createSearchParameters(),
    async execute(_toolCallId, params, signal) {
      const normalizedParams = normalizeSearchParams(params);
      const result = await searchDuckDuckGoForTool(
        normalizedParams,
        duckDuckGoState,
        signal,
      );
      return formatSearchToolResult("duckduckgo", result);
    },
  });
}

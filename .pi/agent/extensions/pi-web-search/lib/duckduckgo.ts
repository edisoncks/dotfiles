// DuckDuckGo provider: lite-HTML fetch through Obscura plus result parsing.
// Depends on lib/types.js (types), lib/filter.js (domain match),
// lib/policy.js (state, slot, errors, signals, formatting).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { REQUEST_TIMEOUT_MS } from "./types.js";
import type {
  DuckDuckGoClassification,
  DuckDuckGoState,
  NormalizedSearchParams,
  ProviderSearchResult,
  WebSearchResult,
} from "./types.js";
import { normalizeDomains, isDomainMatch } from "./filter.js";
import {
  getRequestSignal,
  errorMessage,
  shortErrorMessage,
  waitWithSignal,
  waitForPromiseWithSignal,
  randomJitter,
  DDG_JITTER_MS,
  markDuckDuckGoUnavailable,
  withDuckDuckGoRequestSlot,
  isRetryableDuckDuckGoError,
  getDuckDuckGoCacheKey,
  getCachedDuckDuckGoResult,
  cacheDuckDuckGoResult,
  formatNumberedResults,
  DuckDuckGoUnavailableError,
  DuckDuckGoDriftError,
} from "./policy.js";

const execFileAsync = promisify(execFile);

const DDG_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const OBSCURA_COMMAND = "obscura";
const DDG_MAX_RETRIES = 1;
const DDG_RETRY_BASE_MS = 1_000;
const DUCKDUCKGO_URL = "https://lite.duckduckgo.com/lite";

export function decodeHtmlEntities(value: string): string {
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

export function stripHtml(value: string): string {
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

export function detectDuckDuckGoChallenge(html: string): string | undefined {
  // Structural markers only. Callers gate this on zero parsed results so that
  // snippet text (e.g. a search about "HTTP 429") can never trip the breaker.
  if (/challenge-form|anomaly|captcha|Unfortunately, bots use DuckDuckGo/iu.test(html)) {
    return "DuckDuckGo returned an anti-bot challenge page";
  }
  return undefined;
}

export function buildDuckDuckGoQuery(params: NormalizedSearchParams): string {
  const queryParts = [params.query];

  if (params.allowedDomains.length > 0) {
    queryParts.push(
      `(${params.allowedDomains.map((domain) => `site:${domain}`).join(" OR ")})`,
    );
  }
  queryParts.push(...params.blockedDomains.map((domain) => `-site:${domain}`));

  return queryParts.join(" ");
}

export async function fetchDuckDuckGoAttempt(
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

export async function fetchDuckDuckGoWithRetry(
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

export async function searchDuckDuckGo(
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

export async function searchDuckDuckGoForTool(
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

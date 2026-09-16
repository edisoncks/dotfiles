import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
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


import {
  normalizeDomains,
  isDomainMatch,
} from "./lib/filter.js";

export {
  normalizeDomain,
  normalizeDomains,
  hostnameOf,
  isDomainMatch,
} from "./lib/filter.js";

import {
  getRequestSignal,
  errorMessage,
  shortErrorMessage,
  throwIfAborted,
  waitWithSignal,
  waitForPromiseWithSignal,
  randomJitter,
  DDG_JITTER_MS,
  clampCooldown,
  markDuckDuckGoUnavailable,
  createCircuitOpenError,
  withDuckDuckGoRequestSlot,
  isRetryableDuckDuckGoError,
  getDuckDuckGoCacheKey,
  getCachedDuckDuckGoResult,
  cacheDuckDuckGoResult,
  formatNumberedResults,
  truncateSearchOutput,
  formatSearchToolResult,
  createDuckDuckGoState,
  DuckDuckGoUnavailableError,
  DuckDuckGoDriftError,
} from "./lib/policy.js";

import { searchExaForTool } from "./lib/exa.js";

export {
  isExaQuotaOrRateLimitError,
  createExaSearchError,
  parseSsePayload,
  parseMcpResponse,
  postMcpRequest,
  mcpError,
  textFromMcpResult,
  parseExaStructuredResults,
  formatExaSearchResult,
  searchExa,
  searchExaForTool,
} from "./lib/exa.js";

import { searchDuckDuckGoForTool } from "./lib/duckduckgo.js";

export {
  decodeHtmlEntities,
  stripHtml,
  resolveDuckDuckGoResultUrl,
  parseDuckDuckGoResults,
  classifyDuckDuckGoResponse,
  detectDuckDuckGoChallenge,
  buildDuckDuckGoQuery,
  fetchDuckDuckGoAttempt,
  fetchDuckDuckGoWithRetry,
  searchDuckDuckGo,
  searchDuckDuckGoForTool,
  createDuckDuckGoSearchError,
} from "./lib/duckduckgo.js";

export {
  getRequestSignal,
  errorMessage,
  shortErrorMessage,
  throwIfAborted,
  waitWithSignal,
  waitForPromiseWithSignal,
  randomJitter,
  DDG_JITTER_MS,
  clampCooldown,
  markDuckDuckGoUnavailable,
  createCircuitOpenError,
  withDuckDuckGoRequestSlot,
  isRetryableDuckDuckGoError,
  getDuckDuckGoCacheKey,
  getCachedDuckDuckGoResult,
  cacheDuckDuckGoResult,
  formatNumberedResults,
  truncateSearchOutput,
  formatSearchToolResult,
  createDuckDuckGoState,
  DuckDuckGoUnavailableError,
  DuckDuckGoDriftError,
} from "./lib/policy.js";

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

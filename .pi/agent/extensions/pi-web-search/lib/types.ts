// Shared scalar constants, interfaces, and the isRecord guard.
// No imports: every other lib module may depend on this file.

export const DEFAULT_NUM_RESULTS = 8;
export const MAX_NUM_RESULTS = 20;
export const MIN_QUERY_LENGTH = 2;
export const REQUEST_TIMEOUT_MS = 15_000;

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchParams {
  query: string;
  allowed_domains?: string[];
  blocked_domains?: string[];
  numResults?: number;
}

export interface NormalizedSearchParams {
  query: string;
  allowedDomains: string[];
  blockedDomains: string[];
  numResults: number;
}

export interface ProviderSearchResult {
  text: string;
  resultCount: number;
}

export interface DuckDuckGoCacheEntry {
  result: ProviderSearchResult;
  expiresAt: number;
}

export interface DuckDuckGoState {
  requestQueue: Promise<void>;
  nextRequestAt: number;
  unavailableUntil: number;
  cache: Map<string, DuckDuckGoCacheEntry>;
  inFlight: Map<string, Promise<ProviderSearchResult>>;
}

export interface McpRpcResponse {
  result?: McpToolResult;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

export interface McpToolResult {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
  isError?: boolean;
  structuredContent?: unknown;
}

export interface ExaStructuredResult {
  title: string;
  url: string;
  snippet: string;
}

export type DuckDuckGoClassification =
  | { kind: "results"; results: WebSearchResult[] }
  | { kind: "challenge"; reason: string }
  | { kind: "drift" }
  | { kind: "empty" };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

# pi-web-search

Two web-search tools for pi: `web_search_exa` (primary) and `web_search_ddg`
(fallback via DuckDuckGo Lite through Obscura).

## Layout

```
index.ts            param normalization, tool schemas, pi.registerTool wiring only
lib/types.ts        shared constants, interfaces, isRecord (no dependencies)
lib/filter.ts       domain allow/block matching (pure, dependency-free)
lib/policy.ts       rate limiting, cache, circuit breaker, dedup, formatting
lib/exa.ts          Exa MCP transport + result shaping (types/filter/policy)
lib/duckduckgo.ts   Obscura fetch + lite-HTML parsing (types/filter/policy)
tests/              node:test suites, one file per fix (imports stay on index.ts)
```

Dependency rule: `index → {exa, duckduckgo, policy, filter, types}`,
`exa → {filter, types, policy}`, `duckduckgo → {filter, types, policy}`,
`policy → {types}`, `filter → {types}`. No cycles.

## Provider contracts

- **Exa first.** `searchExaForTool` performs the MCP handshake
  (`initialize` → `notifications/initialized` → `tools/call`) against
  `https://mcp.exa.ai/mcp`, then shapes the tool result. Responses are parsed
  content-type-aware: `text/event-stream` (or a leading `event:`/`data:` line)
  goes down the SSE path, everything else JSON-first with a single fallback
  each way. A JSON body that merely *contains* the substring `data:` must
  never be misrouted to the SSE parser.
- **DuckDuckGo only after Exa fails** (or on explicit user request). Fetched
  with `obscura --stealth fetch <lite-url> --dump html`. Never retried
  immediately per the tool descriptions.

## Filter authority

- Exa advanced tool (`includeDomains`/`excludeDomains`) is authoritative
  server-side when domain filters are present; structured results are
  additionally filtered client-side with `isDomainMatch`.
- DDG results are filtered client-side with `isDomainMatch` (query-embedded
  `site:` operators are a hint, not the authority).
- Hostname parsing is tolerant (`example.com/foo`, `//host/path`,
  trailing dots, case) via `hostnameOf`, but matching stays strict
  (`===` or `.suffix`). Any blank domain entry throws `Invalid domain`
  instead of silently disabling the filter.
- Unstructured Exa text reports `resultCount: 0` rather than guessing from
  body content.

## Drift contract

`drift` (HTML contains `uddg=` but zero parseable results) means DDG changed
markup. It is deterministic: fail fast with “use Exa”, no retry, no
cooldown, no spacing penalty. Only transient I/O is retried (once).
Challenge pages trip the 10–15 min circuit breaker; aborts never retry.

## Dedup contract

Concurrent identical DDG searches share one flight. Shared work runs
signal-less; each waiter applies only its own signal on the wait, so one
caller's abort never rejects co-waiters.

## Prerequisites

- Node `>=20.3` (`AbortSignal.timeout`/`any`; guarded with an actionable error).
- `EXA_API_KEY` optional (warn-and-try): anonymous use is attempted, and
  HTTP 401/403 responses name the key plus the DDG fallback.
- `obscura` on `PATH` for DDG; ENOENT names the binary, `PATH`, and the Exa
  fallback. DDG redirect links without a `uddg` target are dropped rather
  than surfaced as results.

## Dev

```sh
npm install
npm test        # tsx --test tests/**/*.test.ts (node:test)
npm run typecheck
```

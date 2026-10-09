---
name: websearch
description: Search the web and read the sources behind the results, using Obscura stealth mode against DuckDuckGo Lite. Use when an answer depends on current or external information — library or API docs, versions and releases, error messages, prices, dates, news, or anything the user asks to look up — and whenever a claim needs a citable source.
---

# Web search

Two steps, always in this order: search, then open the sources. A search result
is a lead, never evidence.

Scripts live in `scripts/` next to this file. Resolve them relative to this
skill's directory.

## 1. Search

```bash
scripts/ddg-search.sh "python asyncio timeout pattern"
```

Options: `--pages N` (default 1 — each page is one request), `--max N`,
`--no-ads`, `--json`, `--timeout S`.

The output tells you the state of the search:

| state | meaning | what to do |
|---|---|---|
| results listed | normal | go to step 2 |
| no results | the query matched nothing | rephrase, drop operators |
| bot challenge (exit 2) | DuckDuckGo asked for a human | wait ~30 seconds once, then retry; if it repeats, tell the user instead of looping |
| unexpected page (exit 3) | markup changed or fetch failed | re-inspect with `--dump html` (see `references/ddg-lite-dom.md`) |
| robots disallowed (exit 4) | the search host forbids this path | stop. Do not try another host, another user agent, or more stealth |

Read every title and domain before picking. Prefer primary sources: official
documentation, the project's own repo or release notes, the vendor's page, the
paper itself. Treat aggregators, listicles and content farms as last resort.

Re-query rather than page deeper — page 2 of a fuzzy query mostly repeats page 1.
`site:`, quotes and narrower terms usually help more.

## 2. Open the sources

```bash
scripts/ddg-read.sh https://docs.example.org/page https://github.com/org/repo/releases
```

Options: `--max-chars N` (default 6000), `--save DIR`, `--timeout S`.

- Choose depth yourself. Two to five pages is normal for a factual question;
  one authoritative page is enough for a single fact or a definition.
- Prefer the pages behind the best titles over more searches.
- For long pages, use `--save DIR` and then `read` the individual files with
  offset/limit instead of pulling everything into the conversation.
- A URL that fails is reported as `[failed: …]` and does not spoil the batch.
  Say so if it changes what you could verify.

## 3. Answer

- Answer from what you actually read, not from the snippets.
- Name the URLs you used, so the user can check them.
- If the sources disagree or you only found weak ones, say that plainly.
- Never present a snippet, or an obviously stale page, as settled fact.

## Etiquette

- One request per second at most; `--pages 1` unless more is genuinely needed.
- `--obey-robots` is always on in both scripts. If a site refuses, that is the
  answer: report it, never route around it.
- Keep volume as low as the question allows. This is a shared service.

## Beyond search

For screenshots, proxies, CDP sessions, or scraping many URLs at once, use the
`obscura` skill directly instead of the scripts here. The search hostname can be
overridden with `WEBSEARCH_BASE` (used by the tests).

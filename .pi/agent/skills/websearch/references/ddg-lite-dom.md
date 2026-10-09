# DuckDuckGo Lite: DOM, states, and failure modes

Everything here was observed against the live site on 2026-10-09 with
`obscura --stealth fetch`. If results stop making sense, re-inspect first:

```bash
obscura --stealth --obey-robots fetch "https://lite.duckduckgo.com/lite/?q=test" --dump html
obscura --stealth --obey-robots fetch "https://lite.duckduckgo.com/lite/?q=test" --dump links
```

## Selectors

| What | Selector |
|---|---|
| one result's link | `a.result-link` (href is `//duckduckgo.com/l/?uddg=<urlencoded>&rut=…`) |
| real destination | `new URL(href, location).searchParams.get('uddg')` |
| snippet | `td.result-snippet` (in the row *after* the link row) |
| displayed domain | `td span.link-text` |
| sponsored row | `tr.result-sponsored` |
| search form | `form[action="/lite/"] input[name="q"]` |
| paging | `form.next_form` hidden input `s` (10, 20, …), works as `&s=` on GET |
| no more results | a row with the link but no snippet/`link-text` |

`lite.duckduckgo.com` answers `?q=…` over GET without a `vqd` token, but pages
2+ want `&s=10`.

## Traps

- **Sponsors contain a second `a.result-link` labelled "more info".** An
  extractor that iterates anchors emits it as a phantom result and then
  misaligns every following entry. `ddg-extract.js` iterates `table tr` and
  takes the first anchor per row, which dedupes it; the sponsored flag comes
  from `tr.result-sponsored`.
- Text in the HTML is split by `<b>` tags, so grepping the raw HTML for an
  extracted title/snippet fails even when extraction is correct. Verify against
  a text rendering instead.
- Some snippets end in `…` in the page itself.
- The extractor uses `innerText`, which requires live layout — strip elements
  from the live DOM rather than a `cloneNode`.

## Page states (verbatim signatures)

| state | title | form | body |
|---|---|---|---|
| ok | `<query> at DuckDuckGo` | present | result rows |
| empty | `<query> at DuckDuckGo` | present | `No results found for <query> Suggestions: Check spelling Try related keywords Remove unnecessary punctuation` |
| challenge | exactly `DuckDuckGo` | **absent** | `Unfortunately, bots use DuckDuckGo too. Please complete the following challenge to confirm this search was made by a human. Select all squares containing a duck:` |
| unknown | anything else | — | carries a 400-char excerpt |

- The challenge is detected by the body text or by (title `DuckDuckGo` **and**
  no search form). It can never be reported as "no results".
- The challenge **self-clears in about 30 seconds** and leaves no cookie
  (`--dump cookies` → `[]`). It appeared after a handful of odd `site:` probes,
  not from volume: 8 consecutive queries at ~1.2 s spacing were all normal.
  Treat it as "slow down", not "banned".
- `empty` requires the positive `No results found for` text, so a broken parser
  lands in `unknown` with an excerpt instead of silently claiming nothing exists.

## Robots

- `lite.duckduckgo.com/robots.txt` → `Allow: /` (it only asks to be crawled so
  its `noindex` is honoured). Verified: `--obey-robots` still returns results.
- `duckduckgo.com/robots.txt` → `Disallow: /lite`, `Disallow: /html`. Do not
  move the search there.
- A refusal looks like this, on stderr, before any page renders:

  ```
  Error: Failed to navigate to <url>: Network error: Blocked by robots.txt: <url>
  ```

  exit code `1`. That is why both scripts detect it from stderr and exit `4`
  instead of retrying, rehosting, or turning up stealth.

## Extractor output

`ddg-extract.js` returns one JSON string, one page per call:

```json
{"query":"…","page":0,"state":"ok","count":10,"excerpt":"",
 "results":[{"title":"…","url":"https://…","domain":"…","snippet":"…","sponsored":false}]}
```

`ddg-search.sh` merges pages, de-dupes by URL (first wins), and prints either
text or `--json`.

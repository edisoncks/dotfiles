---
name: obscura
description: Use the installed Obscura headless browser CLI for JavaScript-rendered fetching, text/Markdown/link/cookie extraction, parallel scraping, screenshots and PDF, stealth browsing through proxies, persistent sessions, and CDP automation with Puppeteer or Playwright. Use whenever a task needs a rendered page rather than raw HTTP, a screenshot, a bot-resistant fetch, or a crawl of many URLs.
---

# Obscura

A Rust headless browser with its own DOM, CSS and render pipeline on V8 — not a
Chromium build. Installed as `obscura`, with `obscura-worker` beside it. Feature
sets differ between archives, so the binary's own help is authoritative:

```bash
obscura --version
obscura --help
obscura fetch --help        # fetch, scrape, serve and mcp each have their own
```

The behavior described below can change between releases and feature sets. Trust
`--help` and the observed output over this file.

## Fetch one page

```bash
obscura fetch https://example.com --dump text
obscura fetch https://example.com --eval "document.title"
obscura fetch https://example.com --eval "(function(){ return [...document.querySelectorAll('a')].map(a => a.href) })()"
obscura fetch https://example.com --selector "main" --dump markdown -o page.md
```

- `--dump`: `html` (default), `text`, `markdown`, `links`, `assets` (NDJSON of
  every sub-resource plus `fetch()`/XHR URLs), `original` (raw response body,
  binary-safe, bypasses the engine), `cookies` (JSON array, includes HttpOnly).
- `--eval` takes one expression and prints JSON. A top-level `const` or `let`
  evaluates to `null` — wrap multiple statements in an IIFE.
- `-q/--quiet` keeps stdout clean for pipes; `-o/--output` writes a file.

## Waiting

`--wait-until`: `load` (CLI default), `domcontentloaded`, `networkidle2` (≤2
connections active for 500ms), `networkidle0`. Nothing validates this value — a
typo silently behaves as `load`, so judge the output, not the exit code. Under
Puppeteer/Playwright the default is `domcontentloaded` instead.

`--wait` omitted means adaptive settling that returns once the page is quiescent
with a 5s cap; `--wait N` is a fixed N-second delay. `--timeout` bounds
navigation separately (30s for `fetch`, 60s per URL for `scrape`).

## Many URLs

```bash
obscura scrape url1 url2 url3 --concurrency 20 --eval "document.title" --format json
cat urls.txt | obscura scrape - --quiet --format json
printf 'https://a\nhttps://b\n' | obscura fetch --file - --concurrency 4
```

`scrape` renders each page (needs `obscura-worker` on `PATH`, `--format` is
`json` or `text`). `fetch --file` streams raw bodies only — one NDJSON status
line per URL, no DOM and no screenshots.

## Screenshots

```bash
obscura fetch https://example.com -s page.png
obscura fetch https://example.com --eval "window.scrollTo(0, document.body.scrollHeight)" -s bottom.png
```

1280×720 PNG, one URL, `--eval` runs before capture, needs a render-enabled
build, unavailable in `--file` mode. PDF has no CLI flag: use `obscura serve`
(CDP `Page.printToPDF`) or `obscura mcp` (`browser_pdf`). PDF output is
raster-backed, so text is not selectable.

## Local and private addresses

Loopback, RFC1918, link-local (including `169.254.169.254`), and IPv6 ULA are
blocked by default, checked at DNS-resolution time too:

```bash
obscura fetch http://127.0.0.1:8080 --allow-private-network
```

Otherwise the fetch fails with `Access to private/internal IP address
127.0.0.1 is not allowed`. The flag is global, so it also applies to `scrape`,
`serve` and `mcp`. Enable it only for a dev server you know about — never to
reach a URL someone merely pasted, since it defeats the SSRF guard.

## Stealth, proxies and identity

`--stealth` (global) matches browser TLS fingerprints, masks `navigator.webdriver`
and patched native functions, and blocks a 3,520-domain tracker list. It needs a
stealth build. It does not beat Cloudflare interactive challenges, Datadome or
Akamai bot manager, CAPTCHAs, or IP rate limits — those need proxies.

```bash
obscura --proxy http://user:pass@host:8080 --stealth fetch https://example.com
obscura --proxy socks5://host:1080 serve
```

`HTTP_PROXY` / `HTTPS_PROXY` are ignored; use `--proxy` or `OBSCURA_PROXY`. Keep
identity consistent with the exit IP: `OBSCURA_TIMEZONE` (default
`Europe/Berlin`), `OBSCURA_GEOLOCATION="lat,lon"`, `OBSCURA_PROFILE=<index>` to
pin a browser profile, `OBSCURA_ROTATE_PROFILE=1` to rotate per context (leave
off when a proxy region or TLS fingerprint is pinned). `OBSCURA_BLOCK_TRACKERS=0`
keeps the fingerprint but lets trackers through.

## Sessions and stored state

```bash
obscura fetch https://example.com --storage-dir ./state   # cookies.json + localStorage/<origin>.json
obscura serve --storage-dir ./state                       # shared by all CDP sessions
```

State is flushed on clean exit and after each navigation, so logging in once
over CDP and reusing the directory beats replaying a login. `--dump cookies`
retrieves HttpOnly session tokens that `document.cookie` cannot see.

## Drive it from code (CDP)

```bash
obscura serve --port 9222 [--workers N]     # ws://127.0.0.1:9222
```

- Puppeteer: `puppeteer-core` with `browserWSEndpoint: 'ws://127.0.0.1:9222'`
  (not the `puppeteer` package, which downloads Chrome).
- Playwright: `chromium.connectOverCDP('ws://127.0.0.1:9222')` (`connect()`
  speaks Playwright's own protocol, which Obscura does not implement).

Supported: `goto`/`reload`/`goBack`/`goForward`, `evaluate`, `click`/`type`/`fill`,
`waitFor*`, cookies and storage, request interception (`setRequestInterception` /
`route` to block, modify or fulfil), `exposeFunction`, screenshot
(viewport/clip/fullPage), `pdf`, raw CDP screencast, and the DOMSnapshot surface
DOM-agent frameworks need. Pages share one V8 isolate, so a CPU-bound page delays
the others. A non-loopback bind requires `OBSCURA_CDP_TOKEN` (≥32 bytes) sent as
a bearer token.

### playwright-cli against obscura

`playwright-cli` drives obscura instead of launching its own browser — attach to
the CDP server rather than `open`ing a browser:

```bash
obscura serve --port 9222 &
playwright-cli -s=obs attach --cdp=http://127.0.0.1:9222
playwright-cli -s=obs goto https://example.com
playwright-cli -s=obs snapshot                 # then click/type/fill by ref
playwright-cli -s=obs eval "document.title"
playwright-cli -s=obs screenshot --filename=page.png
playwright-cli -s=obs detach                   # obscura keeps running
```

`attach --cdp` accepts a bare `http://host:port` because obscura serves the
`/json/version` discovery endpoint. This path carries the normal playwright-cli
surface: `snapshot`, `eval`, `click`/`type`/`fill`, `screenshot`, `pdf`,
`console`, `requests`, `route`, `cookie-*` and `state-save`/`state-load`.
`detach` (or `close`) ends only the playwright-cli session and leaves the obscura
process up, so use a named session (`-s=`) and a port that is not shared with
another server. `open --browser=chrome` would launch real Chrome instead.

## MCP

`obscura mcp` for stdio, or `obscura mcp --http --port 3000`. Tools act on a live
session, so navigate first and then snapshot, markdown, links, extract,
click/fill/scroll/type, wait, evaluate, read network and console diagnostics, or
handle cookies, storage state and tabs. Render builds add `browser_screenshot`
and `browser_pdf`. Element refs go stale after navigation, clicking, scrolling or
a rerender — take a fresh snapshot. Non-loopback HTTP needs `OBSCURA_MCP_TOKEN`;
browser origins are denied unless `OBSCURA_MCP_ALLOWED_ORIGINS` lists them.

## Tuning

Environment variables, none of which appear in any `--help` output:

| Variable | Default | Purpose |
|---|---:|---|
| `OBSCURA_SCRIPT_DEADLINE_MS` | 30000 | Whole script phase; raise for a heavy SPA shell |
| `OBSCURA_NAV_TIMEOUT_MS` | 30000 | Per-navigation ceiling, applied to the whole chain |
| `OBSCURA_NAV_CHAIN_LIMIT` | 10 | Documents per navigation chain (stops redirect loops) |
| `OBSCURA_FETCH_TIMEOUT_MS` | 30000 | Script `fetch()` / XHR / module requests |
| `OBSCURA_MODULE_BUDGET_MS` | 3000 | Per-module budget for progressive enhancement |
| `OBSCURA_CDP_COMMAND_TIMEOUT_MS` | 60000 | Per-CDP-command V8 deadline; `0` disables |
| `OBSCURA_ALLOW_PRIVATE_NETWORK`, `OBSCURA_PROXY`, `OBSCURA_TIMEZONE`, `OBSCURA_PROFILE`, `OBSCURA_ROTATE_PROFILE`, `OBSCURA_GEOLOCATION`, `OBSCURA_BLOCK_TRACKERS`, `OBSCURA_CDP_TOKEN`, `OBSCURA_MCP_TOKEN` | — | as described above |

Also `--v8-flags "--max-old-space-size=2048"` (default old-generation ceiling
4 GB) and `RUST_LOG=obscura=debug`, or `--verbose`, for logs on stderr.

## Expectations and troubleshooting

Not a Chrome build: service workers, native media, WebGL
(`canvas.getContext('webgl')` returns `null`), some Web APIs, long-tail CSS and
compositor effects, and platform font rasterization can differ.

When output looks wrong:

1. Confirm navigation succeeded and the output is nonempty or the PNG nonblank.
2. Inspect the DOM with `--dump html` or `--eval` instead of guessing.
3. Add an explicit `--wait-until` and/or `--wait`.
4. Simplify the URL or the expression; reduce a real-site failure to a fixture.
5. Use `--dump original` only when the raw bytes are what you want — it skips
   JavaScript entirely.

## Docs

Upstream docs go deeper than this file:
https://github.com/h4ckf0r0day/obscura/tree/main/docs — CLI reference,
environment variables, extraction, stealth and proxies, MCP, Puppeteer and
Playwright, production deployment.

---
name: obscura
description: Operate the installed Obscura CLI for JavaScript-aware fetching, content extraction, parallel scraping, screenshots, proxying, stealth mode, and serving browser sessions.
---

# Obscura CLI

Use the installed `obscura` command-line application for JavaScript-aware page
fetching, extraction, screenshots, parallel scraping, and server operation.

This skill focuses only on CLI invocation and behavior. Do not switch to
Puppeteer, Playwright, MCP, or raw CDP workflows unless the user explicitly
requests them.

## Command discovery

```bash
obscura --help
obscura --version
obscura fetch --help
obscura scrape --help
obscura serve --help
```

Use shell quoting for JavaScript expressions and URLs containing special
characters.

## Fetch one page

Use `fetch` for a single URL:

```bash
obscura fetch https://example.com --eval "document.title"
obscura fetch https://example.com --dump text
obscura fetch https://example.com --dump html
obscura fetch https://example.com --dump links
obscura fetch https://example.com --dump markdown
```

The default dump format is `html`.

### Fetch output modes

```bash
# Rendered HTML
obscura fetch https://example.com --dump html

# Readable text
obscura fetch https://example.com --dump text

# Extract links
obscura fetch https://example.com --dump links

# Convert the page to Markdown
obscura fetch https://example.com --dump markdown

# List referenced sub-resources as NDJSON
obscura fetch https://example.com --dump assets

# Return the raw response body
obscura fetch https://example.com --dump original
```

Use `--dump original` for binary or non-HTML resources such as images, JSON,
JavaScript, and CSS. It bypasses the JavaScript/DOM processing layer and is
binary-safe:

```bash
obscura fetch https://picsum.photos/200/300 --dump original > photo.jpg
```

The `assets` format emits one NDJSON record for each sub-resource URL the page
references.

### Evaluate JavaScript

Use `--eval` to evaluate an expression in the loaded page:

```bash
obscura fetch https://example.com --eval "document.title"
obscura fetch https://example.com \
  --eval "document.querySelector('h1')?.textContent"
```

Write dump or evaluation output to a file with `--output`:

```bash
obscura fetch https://example.com \
  --dump text \
  --output page.txt
```

### Wait for page activity

Use `--wait-until` to select the navigation lifecycle condition:

```bash
obscura fetch https://example.com --wait-until load
obscura fetch https://example.com --wait-until domcontentloaded
obscura fetch https://example.com --wait-until networkidle0
```

The default is `load`.

Use `--selector` when the result depends on a particular element:

```bash
obscura fetch https://example.com \
  --selector "main article" \
  --dump text
```

Use `--wait` for post-load settling:

```bash
# Adaptive settling, used by default, with a five-second cap
obscura fetch https://example.com --dump text

# Fixed post-load delay in seconds
obscura fetch https://example.com --wait 3 --dump text
```

`--wait-until` controls the navigation lifecycle condition. `--wait` controls
additional settling after navigation. `--timeout` bounds navigation separately:

```bash
obscura fetch https://example.com --timeout 10
```

The timeout is measured in seconds and defaults to 30 seconds.

### Capture a screenshot

Capture the settled page as a PNG:

```bash
obscura fetch https://example.com --screenshot page.png
obscura fetch https://example.com -s page.png
```

The CLI screenshot option accepts one URL and requires a rendering-capable
Obscura installation. Combine it with evaluation or scrolling when needed:

```bash
obscura fetch https://example.com \
  --eval "window.scrollTo(0, document.documentElement.scrollHeight)" \
  --screenshot bottom.png
```

## Scrape multiple URLs

Use `scrape` for parallel processing of multiple URLs:

```bash
obscura scrape https://example.com https://news.ycombinator.com \
  --concurrency 25 \
  --eval "document.querySelector('h1')?.textContent" \
  --format json
```

The command uses worker processes and defaults to a concurrency of `10`.

Available options:

| Option | Default | Purpose |
|---|---:|---|
| `--concurrency <N>` | `10` | Number of parallel workers |
| `--eval <EXPR>` | — | Evaluate a JavaScript expression for each page |
| `--format <FORMAT>` | `json` | Emit `json` or `text` output |
| `--quiet` | off | Suppress scrape progress on stderr |
| `--proxy <URL>` | — | Use an HTTP or SOCKS5 proxy |

For script-friendly output, suppress progress messages:

```bash
obscura scrape https://example.com \
  --quiet \
  --format json
```

A proxy can be supplied globally and is inherited by scrape workers:

```bash
obscura --proxy http://127.0.0.1:8080 \
  scrape https://example.com https://news.ycombinator.com
```

## Start the CLI's CDP server

Use `serve` to start Obscura's Chrome DevTools Protocol (CDP) WebSocket
server:

```bash
obscura serve --port 9222
```

Supported server options:

| Option | Default | Purpose |
|---|---:|---|
| `--port <PORT>` | `9222` | CDP WebSocket listening port |
| `--proxy <URL>` | — | HTTP or SOCKS5 proxy |
| `--stealth` | off | Enable anti-detection and tracker blocking |
| `--workers <N>` | `1` | Number of parallel worker processes |
| `--obey-robots` | off | Respect `robots.txt` |

The server command is operated through the CLI and exposes CDP for browser
clients. This skill documents starting and configuring the server, not
Puppeteer, Playwright, or raw CDP client APIs.

## Proxy and stealth operation

Use HTTP or SOCKS5 proxies:

```bash
obscura --proxy http://127.0.0.1:8080 \
  fetch https://example.com --dump text

obscura --proxy socks5://127.0.0.1:1080 \
  fetch https://example.com --dump text
```

Enable stealth mode for anti-detection behavior and tracker blocking:

```bash
obscura --stealth fetch https://example.com --dump text
obscura serve --port 9222 --stealth
```

Stealth mode provides a consistent browser identity, masks
`navigator.webdriver`, masks patched native functions, and blocks the built-in
tracker-domain list. It requires a stealth-capable Obscura installation.

Use `--obey-robots` when the workflow must respect `robots.txt`:

```bash
obscura serve --port 9222 --obey-robots
```

## JavaScript-heavy pages

Pass raw V8 flags with `--v8-flags`. A common use is increasing the JavaScript
heap limit:

```bash
obscura --v8-flags "--max-old-space-size=4096" \
  fetch https://example.com
```

For heavy single-page applications using the CLI server, increase the script
execution budget when necessary:

```bash
OBSCURA_SCRIPT_DEADLINE_MS=60000 \
  obscura serve --port 9222
```

The default script execution budget is 30 seconds. The deadline only affects
pages that continue executing scripts; pages that finish sooner return
normally.

## Output and timing guidelines

- Use `--dump html`, `text`, `links`, or `markdown` for DOM-oriented extraction.
- Use `--eval` for a targeted value rather than parsing an entire page.
- Use `--dump assets` to inspect referenced sub-resources.
- Use `--dump original` for raw, binary-safe response bodies.
- Use `--output` when another process needs a file instead of stdout.
- Use `--quiet` when stdout or stderr must remain script-friendly.
- Use `--wait-until networkidle0` for pages whose useful content arrives after
  initial DOM construction.
- Use `--wait` when a page needs additional settling after its lifecycle event.
- Use `--timeout` to prevent slow or broken navigation from running
  indefinitely.
- Use screenshots only when rendered visual output is required.

## Rendering expectations

Obscura is an independent browser engine rather than a bundled Chromium build.
It supports common layout, paint, JavaScript, screenshot, and extraction paths,
but long-tail CSS, some Web APIs, media playback, compositor effects, and
platform font rasterization can differ from Chromium.

When a result looks incorrect:

1. Confirm navigation succeeded.
2. Confirm the output is nonempty.
3. Try an explicit `--wait-until` or `--wait`.
4. Use `--eval` or `--dump html` to inspect the loaded DOM.
5. Use `--dump original` only when raw response data is intended.
6. Reduce complicated pages to a simpler URL or extraction expression.

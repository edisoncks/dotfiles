#!/usr/bin/env bash
# ddg-search.sh — web search through DuckDuckGo Lite using Obscura stealth mode.
# Part of the `websearch` skill; see ../SKILL.md.
#
# Results are titles/URLs/snippets only. They are LEADS, not answers:
# open the promising ones with ddg-read.sh before relying on them.
#
# exit 0  ok (including "no results")
# exit 2  DuckDuckGo served a bot challenge — wait ~30s, do not loop
# exit 3  fetch/parse failure, or an unrecognised page
# exit 4  robots.txt disallows the search host — do not work around it
# exit 64 bad usage

set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
EXTRACT_JS="$SCRIPT_DIR/ddg-extract.js"

BASE="${WEBSEARCH_BASE:-https://lite.duckduckgo.com/lite/}"
PAGES=1
MAX=0
TIMEOUT=30
JSON=0
NO_ADS=0
QUERY=""

usage() {
  cat <<'EOF'
usage: ddg-search.sh "query" [options]

  --pages N      result pages to fetch (default 1; each page = 1 request)
  --max N        print at most N results (default: all)
  --no-ads       drop sponsored results
  --json         emit JSON instead of text
  --timeout S    per-request navigation timeout (default 30)
  -h, --help     this message

env:
  WEBSEARCH_BASE  search base URL (default https://lite.duckduckgo.com/lite/)
EOF
}

die_usage() { echo "ddg-search.sh: $1" >&2; echo "try --help" >&2; exit 64; }

while [ $# -gt 0 ]; do
  case "$1" in
    --pages)   [ $# -ge 2 ] || die_usage "--pages needs a value"; PAGES="$2"; shift 2 ;;
    --max)     [ $# -ge 2 ] || die_usage "--max needs a value"; MAX="$2"; shift 2 ;;
    --timeout) [ $# -ge 2 ] || die_usage "--timeout needs a value"; TIMEOUT="$2"; shift 2 ;;
    --no-ads)  NO_ADS=1; shift ;;
    --json)    JSON=1; shift ;;
    -h|--help) usage; exit 0 ;;
    --*)       die_usage "unknown option: $1" ;;
    *)         if [ -z "$QUERY" ]; then QUERY="$1"; else QUERY="$QUERY $1"; fi; shift ;;
  esac
done

[ -n "$QUERY" ] || die_usage "no query given"
case "$PAGES"   in ''|*[!0-9]*) die_usage "--pages must be a positive integer" ;; esac
case "$MAX"     in *[!0-9]*)     die_usage "--max must be a non-negative integer" ;; esac
case "$TIMEOUT" in ''|*[!0-9]*)  die_usage "--timeout must be a positive integer" ;; esac
[ "$PAGES" -ge 1 ] || die_usage "--pages must be >= 1"
[ -r "$EXTRACT_JS" ] || { echo "ddg-search.sh: missing $EXTRACT_JS" >&2; exit 3; }
command -v obscura >/dev/null 2>&1 || { echo "ddg-search.sh: obscura not found on PATH" >&2; exit 3; }

if command -v python3 >/dev/null 2>&1; then
  ENC=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote_plus(sys.argv[1]))' "$QUERY")
elif command -v jq >/dev/null 2>&1; then
  ENC=$(printf '%s' "$QUERY" | jq -sRr '@uri')
else
  echo "ddg-search.sh: need python3 or jq to URL-encode the query" >&2
  exit 3
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
: > "$TMP/pages.jsonl"

page_i=0
while [ "$page_i" -lt "$PAGES" ]; do
  s=$((page_i * 10))
  if [ "$page_i" -eq 0 ]; then
    url="${BASE}?q=${ENC}"
  else
    url="${BASE}?q=${ENC}&s=${s}"
  fi

  out="$(obscura --stealth --obey-robots fetch "$url" \
           --eval "$(cat "$EXTRACT_JS")" \
           --timeout "$TIMEOUT" -q 2>"$TMP/err")"
  rc=$?

  if [ "$rc" -ne 0 ]; then
    if grep -qi 'Blocked by robots.txt' "$TMP/err"; then
      echo "ddg-search.sh: robots.txt disallows ${BASE} — refusing to search. Do not work around this." >&2
      exit 4
    fi
    echo "ddg-search.sh: fetch failed (exit $rc): $(tr '\n' ' ' <"$TMP/err" | head -c 300)" >&2
    exit 3
  fi

  printf '%s' "$out" > "$TMP/page.json"
  if ! state=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["state"])' "$TMP/page.json" 2>/dev/null); then
    echo "ddg-search.sh: could not parse extractor output:" >&2
    head -c 300 "$TMP/page.json" >&2
    echo >&2
    exit 3
  fi

  case "$state" in
    robots-denied)
      echo "ddg-search.sh: robots.txt disallows ${BASE} — refusing to search. Do not work around this." >&2
      exit 4
      ;;
    challenge)
      echo "ddg-search.sh: DuckDuckGo served a bot challenge instead of results." >&2
      echo "Wait ~30 seconds (it clears by itself), then try again — once, not in a loop." >&2
      exit 2
      ;;
  esac

  # Trailing newline matters: page records are appended line by line.
  cat "$TMP/page.json" >> "$TMP/pages.jsonl"
  printf '\n' >> "$TMP/pages.jsonl"
  page_i=$((page_i + 1))
  [ "$page_i" -lt "$PAGES" ] && sleep 1
done

python3 - "$TMP/pages.jsonl" "$QUERY" "$JSON" "$NO_ADS" "$MAX" "$PAGES" <<'PY'
import json, sys

path, query, as_json, no_ads, max_n, pages = sys.argv[1:7]
as_json, no_ads, max_n, pages = int(as_json), int(no_ads), int(max_n), int(pages)

records = []
with open(path) as fh:
    for line in fh:
        line = line.strip()
        if line:
            records.append(json.loads(line))

states = [r.get("state", "unknown") for r in records]
seen, merged = set(), []
for rec in records:
    for r in rec.get("results", []):
        if r["url"] in seen:
            continue
        seen.add(r["url"])
        merged.append(r)

usable = any(s in ("ok", "empty") for s in states)
sponsored = sum(1 for r in merged if r.get("sponsored"))
shown = [r for r in merged if not (no_ads and r.get("sponsored"))]
if max_n:
    shown = shown[:max_n]

state = "ok"
if "challenge" in states:
    state = "challenge"
elif not usable:
    state = "unknown" if "unknown" in states else "empty"
elif "unknown" in states:
    state = "partial"
elif not merged:
    state = "empty"

if as_json:
    print(json.dumps({
        "query": query, "pages": pages, "state": state,
        "count": len(shown), "found": len(merged),
        "sponsored": sponsored, "results": shown,
    }, indent=2))
else:
    if state in ("challenge",):
        print(f'search "{query}": DuckDuckGo served a bot challenge, not results.')
        print("Wait ~30 seconds and run the search again once.")
    elif state == "empty":
        print(f'search "{query}": no results.')
        print("Try different terms, drop operators, or fewer filters.")
    elif state == "unknown":
        print(f'search "{query}": unexpected page — could not confirm results.')
        for rec in records:
            if rec.get("excerpt"):
                print(f'  excerpt: {rec["excerpt"][:300]}')
        print("Re-inspect with: obscura --stealth fetch \"<search url>\" --dump html")
    else:
        print(f'search "{query}": {len(shown)} of {len(merged)} results '
              f'({pages} page{"s" if pages != 1 else ""}{", ads hidden" if no_ads else ""})')
        print()
        for i, r in enumerate(shown, 1):
            tag = " [sponsored]" if r.get("sponsored") else ""
            print(f'{i}. {r["title"]}{tag}')
            print(f'   {r["url"]}')
            if r.get("snippet"):
                snip = r["snippet"]
                if len(snip) > 280:
                    snip = snip[:277].rstrip() + "..."
                print(f'   {snip}')
            print()
        if sponsored and not no_ads:
            print(f'({sponsored} sponsored result{"s" if sponsored != 1 else ""} included; '
                  f'use --no-ads to hide)')
        if state == "partial":
            print("(one page came back unrecognised; remaining results shown)")
        print("Snippets are leads only — open the promising sources with ddg-read.sh "
              "before using them as evidence.")

sys.exit(3 if not usable else 0)
PY
exit $?

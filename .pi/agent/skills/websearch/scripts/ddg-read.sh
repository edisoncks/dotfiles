#!/usr/bin/env bash
# ddg-read.sh — open result pages and get their real content.
# Part of the `websearch` skill; see ../SKILL.md.
#
# Extraction is innerText after stripping boilerplate (nav/header/footer/aside/
# form/scripts), preferring <main>/<article> when present. Measured against
# --dump markdown and raw innerText on Wikipedia, docs.python.org and Real
# Python: this was the only variant whose first line was prose instead of
# navigation.
#
# exit 0  ok (a failing individual URL is reported inline, not fatal)
# exit 2  DuckDuckGo-style bot challenge (not expected on ordinary pages)
# exit 3  all URLs failed, or obscura/parse failure
# exit 4  robots.txt disallows a requested URL — do not work around it
# exit 64 bad usage

set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

MAX_CHARS=6000
SAVE_DIR=""
TIMEOUT=40
URLS=()

usage() {
  cat <<'EOF'
usage: ddg-read.sh [options] URL [URL...]

  --max-chars N   characters of body text per page (default 6000)
  --save DIR      write one markdown file per page plus a manifest instead of
                  printing text (better for long pages: read them with offset)
  --timeout S     per-page navigation timeout (default 40)
  -h, --help      this message
EOF
}

die_usage() { echo "ddg-read.sh: $1" >&2; echo "try --help" >&2; exit 64; }

while [ $# -gt 0 ]; do
  case "$1" in
    --max-chars) [ $# -ge 2 ] || die_usage "--max-chars needs a value"; MAX_CHARS="$2"; shift 2 ;;
    --save)      [ $# -ge 2 ] || die_usage "--save needs a directory"; SAVE_DIR="$2"; shift 2 ;;
    --timeout)   [ $# -ge 2 ] || die_usage "--timeout needs a value"; TIMEOUT="$2"; shift 2 ;;
    -h|--help)   usage; exit 0 ;;
    --*)         die_usage "unknown option: $1" ;;
    *)           URLS+=("$1"); shift ;;
  esac
done

[ "${#URLS[@]}" -ge 1 ] || die_usage "no URL given"
case "$MAX_CHARS" in ''|*[!0-9]*) die_usage "--max-chars must be a positive integer" ;; esac
case "$TIMEOUT"   in ''|*[!0-9]*) die_usage "--timeout must be a positive integer" ;; esac
[ "$MAX_CHARS" -ge 200 ] || die_usage "--max-chars must be at least 200"
command -v obscura >/dev/null 2>&1 || { echo "ddg-read.sh: obscura not found on PATH" >&2; exit 3; }

# Strip boilerplate, prefer the main content region, then truncate in-page so
# we only transfer what we need.
STRIP_JS='(() => {
  document.querySelectorAll("script,style,noscript,svg,iframe,nav,header,footer,aside,form,button,[role=navigation],[role=banner],[aria-hidden=\"true\"]").forEach(e => e.remove());
  const main = document.querySelector("main, article, [role=main]") || document.body;
  let t = (main.innerText || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!t) t = (document.body.innerText || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!t) return "(no readable text extracted from this page)";
  if (t.length > __MAX__) {
    const full = t.length;
    t = t.slice(0, __MAX__) + "\n\n[... truncated: showing __MAX__ of " + full + " characters ...]";
  }
  return t;
})()'
STRIP_JS="${STRIP_JS//__MAX__/$MAX_CHARS}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

out="$(obscura --stealth --obey-robots scrape "${URLS[@]}" \
         --eval "$STRIP_JS" --format json --quiet --timeout "$TIMEOUT" 2>"$TMP/err")"
rc=$?

if [ "$rc" -ne 0 ]; then
  if grep -qi 'Blocked by robots.txt' "$TMP/err"; then
    echo "ddg-read.sh: robots.txt disallows one of the requested URLs — refusing to fetch it. Do not work around this." >&2
    grep -i 'Blocked by robots.txt' "$TMP/err" >&2
    exit 4
  fi
  echo "ddg-read.sh: scrape failed (exit $rc): $(tr '\n' ' ' <"$TMP/err" | head -c 300)" >&2
  exit 3
fi

printf '%s' "$out" > "$TMP/out.json"

python3 - "$TMP/out.json" "$SAVE_DIR" "$MAX_CHARS" <<'PY'
import json, os, re, sys, unicodedata

path, save_dir, max_chars = sys.argv[1], sys.argv[2], int(sys.argv[3])

try:
    with open(path) as fh:
        payload = json.load(fh)
except Exception as exc:  # noqa: BLE001 - report, do not crash the caller
    print(f"ddg-read.sh: could not parse scrape output: {exc}", file=sys.stderr)
    sys.exit(3)

results = payload.get("results") or []


def body_of(entry):
    """Return (text, error). Tolerant of the shapes obscura may return."""
    text = entry.get("eval")
    if isinstance(text, str) and text.strip():
        return text.strip(), None
    err = entry.get("error") or entry.get("status") or "no content returned"
    if isinstance(err, dict):
        err = err.get("message") or json.dumps(err)
    # Error chains from the browser engine can be enormous; keep them readable.
    return "", " ".join(str(err).split())[:200] or "no content returned"


def slugify(url, index):
    url = re.sub(r"^[a-zA-Z]+://", "", url)
    url = url.split("#")[0].split("?")[0].strip("/")
    url = unicodedata.normalize("NFKD", url).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^A-Za-z0-9]+", "-", url).strip("-").lower()
    return f"{index:02d}-{slug[:60].strip('-') or 'page'}"


saved, failed = [], []
for i, entry in enumerate(results, 1):
    url = entry.get("url", "")
    title = (entry.get("title") or "").strip() or "(untitled)"
    text, err = body_of(entry)
    if err:
        failed.append((url, err))
        continue
    if save_dir:
        saved.append((i, title, url, text))
    else:
        print(f"## {title}")
        print(url)
        print()
        print(text)
        print()

if save_dir and saved:
    os.makedirs(save_dir, exist_ok=True)
    manifest = os.path.join(save_dir, "manifest.txt")
    lines = []
    for i, title, url, text in saved:
        fname = slugify(url, i) + ".md"
        fpath = os.path.join(save_dir, fname)
        with open(fpath, "w") as fh:
            fh.write(f"# {title}\n\n> {url}\n\n{text}\n")
        lines.append(f"{i}\t{title}\t{url}\t{len(text)} chars\t{fpath}")
    for url, err in failed:
        lines.append(f"-\tFAILED\t{url}\t-\t{err}")
    with open(manifest, "w") as fh:
        fh.write("\n".join(lines) + "\n")
    print(f"saved {len(saved)} page(s) to {save_dir}")
    print(f"manifest: {manifest}")
    for line in lines:
        print("  " + line)

for url, err in failed:
    print(f"[failed: {url} — {err}]")

if not saved and not results:
    print("ddg-read.sh: scrape returned no results", file=sys.stderr)
    sys.exit(3)

ok = len(saved) if save_dir else sum(1 for e in results if body_of(e)[1] is None)
if ok == 0:
    print("ddg-read.sh: every URL failed", file=sys.stderr)
    sys.exit(3)
PY
exit $?

#!/bin/bash
# Fetch Anime4K GLSL shaders (pinned to v4.0.1) into .config/mpv/shaders/.
# Idempotent: skips when shaders are already present unless --force is given.
set -euo pipefail

ANIME4K_VERSION="v4.0.1"
ANIME4K_URL="https://github.com/bloc97/Anime4K/releases/download/${ANIME4K_VERSION}/Anime4K_v4.0.zip"
SHADER_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)/shaders"
MARKER="$SHADER_DIR/Anime4K_Clamp_Highlights.glsl"

if [ "${1:-}" != "--force" ] && [ -f "$MARKER" ]; then
	echo "✅ Anime4K shaders already present in $SHADER_DIR, skipping (use --force to re-fetch)"
	exit 0
fi

mkdir -p "$SHADER_DIR"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR:?}"' EXIT

echo "⌛ Downloading Anime4K $ANIME4K_VERSION..."
curl -fsSL --retry 3 --retry-delay 2 --retry-all-errors -o "$WORK_DIR/Anime4K.zip" "$ANIME4K_URL"

if command -v unzip >/dev/null 2>&1; then
	unzip -o -q -j "$WORK_DIR/Anime4K.zip" '*.glsl' -d "$SHADER_DIR"
elif command -v 7z >/dev/null 2>&1; then
	7z x -y -o"$SHADER_DIR" "$WORK_DIR/Anime4K.zip" '*.glsl' >/dev/null
else
	echo "❌ Neither unzip nor 7z found (brew install sevenzip) — shaders not installed"
	exit 1
fi

count=$(find "$SHADER_DIR" -maxdepth 1 -name '*.glsl' | wc -l | tr -d '[:space:]')
echo "✅ Installed $count Anime4K shaders into $SHADER_DIR"

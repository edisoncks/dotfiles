#!/bin/bash
set -euo pipefail

# Custom mise install path, default to ~/.local/bin/mise.
# Exported so the mise installer (curl | sh) honors the override.
export MISE_INSTALL_PATH="${MISE_INSTALL_PATH:-$HOME/.local/bin/mise}"

# Ensure mise is installed
mise_ready() { [ -x "$MISE_INSTALL_PATH" ]; }
if mise_ready; then
  echo "✅ mise is installed"
else
  echo "⏳ Installing mise..."
  curl -fsSL https://mise.run | sh
fi
if ! mise_ready; then
  echo "❌ mise installation failed: $MISE_INSTALL_PATH is missing or not executable." >&2
  exit 1
fi

# Symlink dotfiles
DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
declare -a DOTFILES=(
  ".bashrc.d"
  ".config/ghostty"
  ".config/lazygit"
  ".config/mise"
  ".config/mpv"
  ".config/neovide"
  ".config/nvim"
  ".config/starship.toml"
  ".config/topgrade.toml"
  ".config/yazi"
  ".pi/agent/settings.json"
  ".pi/agent/keybindings.json"
  ".pi/agent/pi-statusline.json"
  ".pi/agent/models.json"
  ".pi/agent/extensions"
  ".pi/agent/prompts"
  ".pi/agent/skills"
  ".bash_profile"
  ".bashrc"
  ".gitconfig"
)
for i in "${DOTFILES[@]}"; do
  DOTFILE="$DIR/$i"
  mkdir -p "$(dirname "$HOME/$i")"
  if [ -L "$HOME/$i" ] && [ "$(readlink "$HOME/$i")" = "$DOTFILE" ]; then
    continue # already linked correctly — nothing to do
  fi
  if [ -e "$HOME/$i" ] && [ ! -L "$HOME/$i" ]; then
    backup="$HOME/$i.bak.$(date +%s)"
    mv "$HOME/$i" "$backup"
    echo "🗂️  Backed up ~/$i to $backup"
  fi
  ln -sfn "$DOTFILE" "$HOME/$i"
  echo "✅ Created symlinks for ~/$i"
done

# Install mise tools
"$MISE_INSTALL_PATH" install
echo "✅ Installed mise tools"

# Activate mise
eval "$($MISE_INSTALL_PATH activate bash)"

# Fetch Anime4K shaders (ignored, not vendored)
"$DIR/.config/mpv/fetch-anime4k.sh" || echo "⚠️  Anime4K fetch failed (offline?) — run .config/mpv/fetch-anime4k.sh later"

# Install fonts (pinned; idempotent via per-font version markers)
# Runs last, after mise tools are installed, so 7zz (mise-managed 7zip) is
# available and a network hiccup cannot block package installation.
NERD_FONTS_VERSION="v3.5.1"
MAPLE_FONT_VERSION="v7.9"
FONT_DIR="$HOME/.local/share/fonts"

# Mononoki Nerd Font
FONT_MARKER="$FONT_DIR/.mononoki-nerd-font.version"
if [ -f "$FONT_MARKER" ] && [ "$(cat "$FONT_MARKER")" = "$NERD_FONTS_VERSION" ]; then
  echo "✅ Mononoki Nerd Font $NERD_FONTS_VERSION already installed"
else
  echo "⌛ Installing Mononoki Nerd Font $NERD_FONTS_VERSION..."
  mkdir -p "$FONT_DIR"
  (
    tmp="$(mktemp -d)"
    trap 'rm -rf "${tmp:?}"' EXIT
    curl -fsSL --retry 3 --retry-delay 2 --retry-all-errors \
      -o "$tmp/Mononoki.tar.xz" \
      "https://github.com/ryanoasis/nerd-fonts/releases/download/${NERD_FONTS_VERSION}/Mononoki.tar.xz"
    tar -xJf "$tmp/Mononoki.tar.xz" -C "$FONT_DIR" --wildcards '*.ttf'
  )
  printf '%s\n' "$NERD_FONTS_VERSION" >"$FONT_MARKER"
  if command -v fc-cache >/dev/null 2>&1; then
    fc-cache -f "$FONT_DIR" >/dev/null
  fi
  echo "✅ Installed Mononoki Nerd Font $NERD_FONTS_VERSION into $FONT_DIR"
fi

# Maple Mono NF CN (unhinted)
MAPLE_FONT_MARKER="$FONT_DIR/.maple-mono-nf-cn.version"
if [ -f "$MAPLE_FONT_MARKER" ] && [ "$(cat "$MAPLE_FONT_MARKER")" = "$MAPLE_FONT_VERSION" ]; then
  echo "✅ Maple Mono NF CN $MAPLE_FONT_VERSION already installed"
else
  echo "⌛ Installing Maple Mono NF CN $MAPLE_FONT_VERSION..."
  mkdir -p "$FONT_DIR"
  (
    tmp="$(mktemp -d)"
    trap 'rm -rf "${tmp:?}"' EXIT
    curl -fsSL --retry 3 --retry-delay 2 --retry-all-errors \
      -o "$tmp/MapleMono-NF-CN-unhinted.zip" \
      "https://github.com/subframe7536/maple-font/releases/download/${MAPLE_FONT_VERSION}/MapleMono-NF-CN-unhinted.zip"
    if command -v 7zz >/dev/null 2>&1; then
      7zz x -y -o"$FONT_DIR" "$tmp/MapleMono-NF-CN-unhinted.zip" '*.ttf' >/dev/null
    elif command -v unzip >/dev/null 2>&1; then
      unzip -q -o "$tmp/MapleMono-NF-CN-unhinted.zip" -d "$FONT_DIR" '*.ttf'
    elif command -v 7z >/dev/null 2>&1; then
      7z x -y -o"$FONT_DIR" "$tmp/MapleMono-NF-CN-unhinted.zip" '*.ttf' >/dev/null
    else
      echo "❌ 7zip or unzip is required to install Maple Mono NF CN" >&2
      exit 1
    fi
  )
  printf '%s\n' "$MAPLE_FONT_VERSION" >"$MAPLE_FONT_MARKER"
  if command -v fc-cache >/dev/null 2>&1; then
    fc-cache -f "$FONT_DIR" >/dev/null
  fi
  echo "✅ Installed Maple Mono NF CN $MAPLE_FONT_VERSION into $FONT_DIR"
fi

# Reminder for the user's interactive shell only; the script itself is self-contained
# (aliases, mise activate, etc. are loaded by sourcing ~/.bash_profile)
echo "🚀 Done. Run 'source ~/.bash_profile' in this shell to pick up the new environment immediately (or just open a new terminal)."

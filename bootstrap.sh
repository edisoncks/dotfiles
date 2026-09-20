#!/bin/bash
set -euo pipefail

# Custom mise install path, default to ~/.local/bin/mise.
# Exported so the mise installer (curl | sh) honors the override.
export MISE_INSTALL_PATH="${MISE_INSTALL_PATH:-$HOME/.local/bin/mise}"

# Ensure mise is installed
if [ -x "$MISE_INSTALL_PATH" ]; then
	echo "✅ mise is installed"
else
	echo "⏳ Installing mise..."
	curl -fsSL https://mise.run | sh
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

# Install mise packages
"$MISE_INSTALL_PATH" install
echo "✅ Installed mise packages"

# Activate mise
eval "$($MISE_INSTALL_PATH activate bash)"

# Fetch Anime4K shaders (ignored, not vendored)
"$DIR/.config/mpv/fetch-anime4k.sh" || echo "⚠️  Anime4K fetch failed (offline?) — run .config/mpv/fetch-anime4k.sh later"

# Install Mononoki Nerd Font (pinned; idempotent via version marker)
# Runs last and uses only stock tools (curl/tar/xz), so a network hiccup
# cannot block package installation.
NERD_FONTS_VERSION="v3.5.1"
FONT_DIR="$HOME/.local/share/fonts"
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

# Reminder for the user's interactive shell only; the script itself is self-contained
# (aliases, mise activate, etc. are loaded by sourcing ~/.bash_profile)
echo "🚀 Done. Run 'source ~/.bash_profile' in this shell to pick up the new environment immediately (or just open a new terminal)."

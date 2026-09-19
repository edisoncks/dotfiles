#!/bin/bash
set -euo pipefail

# Ensure homebrew is installed
if command -v brew >/dev/null 2>&1; then
	echo "✅ Homebrew is installed"
else
	echo "⌛ Installing homebrew..."
	/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# Ensure homebrew binary is in PATH (a fresh install isn't on this shell's PATH yet)
HOMEBREW_PREFIX="${HOMEBREW_PREFIX:-/home/linuxbrew/.linuxbrew}"
case ":$PATH:" in
	*":$HOMEBREW_PREFIX/bin:"*) ;;
	*) export PATH="$PATH:$HOMEBREW_PREFIX/bin" ;;
esac
case ":$PATH:" in
	*":$HOMEBREW_PREFIX/sbin:"*) ;;
	*) export PATH="$PATH:$HOMEBREW_PREFIX/sbin" ;;
esac
export HOMEBREW_NO_ASK=1
export HOMEBREW_NO_ANALYTICS=1

if ! command -v brew >/dev/null 2>&1; then
	echo "❌ Homebrew installation failed"
	exit 1
fi

# Create symlinks
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
	ln -sf "$DOTFILE" "$HOME/$i"
	echo "✅ Created symlinks for ~/$i"
done

# Fetch Anime4K shaders (ignored, not vendored)
"$DIR/.config/mpv/fetch-anime4k.sh" || echo "⚠️  Anime4K fetch failed (offline?) — run .config/mpv/fetch-anime4k.sh later"

# Install homebrew packages
brew bundle --file="$DIR/Brewfile"
# -full variants required for yazi previews (see Brewfile); --overwrite needed
# because Homebrew's default ffmpeg/imagemagick kegs conflict on link
brew link ffmpeg-full imagemagick-full -f --overwrite
echo "✅ Installed homebrew packages"

# Install mise packages
mise install
echo "✅ Installed mise packages"

# Install npm deps for bundled pi extensions (lockfiles tracked, node_modules ignored)
if command -v npm >/dev/null 2>&1; then
	for ext in "$DIR/.pi/agent/extensions/"*/; do
		if [ -f "$ext/package.json" ] && [ -f "$ext/package-lock.json" ]; then
			echo "⌛ Installing npm deps in $ext..."
			(cd "$ext" && npm ci --no-audit --no-fund)
		fi
	done
else
	echo "❌ npm not found — cannot install pi extension deps" >&2
	exit 1
fi

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

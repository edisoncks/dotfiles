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
if ! [[ "$PATH" =~ "$HOMEBREW_PREFIX/bin:$HOMEBREW_PREFIX/sbin" ]]; then
	export PATH="$PATH:$HOMEBREW_PREFIX/bin:$HOMEBREW_PREFIX/sbin"
fi
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
	".config/environment.d/nvidia-prime.conf"
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
	".pi/agent/extensions"
	".pi/agent/prompts"
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

# Install homebrew packages
brew bundle --file="$DIR/Brewfile"
brew link ffmpeg-full imagemagick-full -f --overwrite
echo "✅ Installed homebrew packages"

# Install mise packages
mise install
echo "✅ Installed mise packages"

# Reminder for the user's interactive shell only; the script itself is self-contained
# (aliases, mise activate, etc. are loaded by sourcing ~/.bash_profile)
echo "🚀 Done. Run 'source ~/.bash_profile' in this shell to pick up the new environment immediately (or just open a new terminal)."

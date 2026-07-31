#!/bin/bash
set -euo pipefail

# Ensure homebrew is installed
if command -v brew >/dev/null 2>&1; then
	echo "✅ Homebrew is installed"
else
	echo "⌛ Installing homebrew..."
	/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
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
	".bash_profile"
	".bashrc"
	".gitconfig"
)
for i in "${DOTFILES[@]}"; do
	DOTFILE="$DIR/$i"
	mkdir -p "$(dirname "$HOME/$i")"
	if [ -e "$HOME/$i" ] && [ ! -L "$HOME/$i" ]; then
		mv "$HOME/$i" "$HOME/$i.bak"
	fi
	ln -sf "$DOTFILE" "$HOME/$i"
	echo "✅ Created symlinks for ~/$i"
done
source "$HOME/.bash_profile"

# Install homebrew packages
brew bundle --file="$DIR/Brewfile"
brew link ffmpeg-full imagemagick-full -f --overwrite
echo "✅ Installed homebrew packages"

# Install mise packages
mise install
echo "✅ Installed mise packages"

echo "🚀 Done. Run 'source ~/.bash_profile' in this shell to pick up the new environment immediately (or just open a new terminal)."

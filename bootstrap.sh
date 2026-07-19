#!/bin/bash

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
	".claude/settings.json"
	".claude/statusline.sh"
	".config/environment.d/nvidia-prime.conf"
	".config/ghostty"
	".config/lazygit"
	".config/mise"
	".config/mpv"
	".config/neovide"
	".config/nvim"
	".config/yazi"
	".bash_profile"
	".bashrc"
	".gitconfig"
)
for i in "${DOTFILES[@]}"; do
	DOTFILE="$DIR/$i"
	mkdir -p "$(dirname "$HOME/$i")"
	mv "$HOME/$i" "$HOME/$i.bak" >/dev/null 2>&1
	ln -s "$DOTFILE" "$HOME/$i"
	echo "✅ Created symlinks for ~/$i"
done
source $HOME/.bash_profile

# Install homebrew packages
brew install \
	aria2 \
	bat \
	bbrew \
	bottom \
	btop \
	fastfetch \
	fd \
	ffmpeg-full \
	font-symbols-only-nerd-font \
	fzf \
	gh \
	git-delta \
	imagemagick-full \
	jq \
	lazygit \
	mise \
	mpv \
	neovide \
	neovim \
	nvtop \
	onedrive-cli \
	opencode \
	podman-tui \
	poppler \
	resvg \
	ripgrep \
	screen \
	sevenzip \
	tree-sitter-cli \
	wgcf \
	yazi \
	zoxide
brew link ffmpeg-full imagemagick-full -f --overwrite
echo "✅ Installed homebrew packages"

# Install mise packages
mise install
echo "✅ Installed mise packages"

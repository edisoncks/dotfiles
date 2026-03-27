#!/bin/bash

# Ensure homebrew is installed
if command -v brew >/dev/null 2>&1; then
	echo "✅ Homebrew is installed"
else
	echo "⛔ Homebrew not found"
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
	".config/yazi"
	".bash_profile"
	".bashrc"
	".gitconfig"
)
for i in "${DOTFILES[@]}"; do
	DOTFILE="$DIR/$i"
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
	fd \
	ffmpeg-full \
	fzf \
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
	wgcf \
	yazi \
	zoxide
echo "✅ Installed homebrew packages"

# Install mise packages
mise install
echo "✅ Installed mise packages"

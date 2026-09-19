# 🗃️ edisoncks's dotfiles

![Platform](https://img.shields.io/badge/platform-Linux-blue?logo=archlinux) ![GitHub last commit (branch)](https://img.shields.io/github/last-commit/edisoncks/dotfiles/main?logo=github)

## 🛠️ Prerequisites

Linux with `bash`, `curl`, and `tar` (with `xz` support) (`fc-cache` is optional,
used to refresh the font cache when available).

No manual mise installation is needed — `bootstrap.sh` installs mise to
`~/.local/bin/mise` (override with `MISE_INSTALL_PATH`).

## 📥 Getting started

```bash
bash bootstrap.sh
# then, to apply in the current shell (a new shell works too):
source ~/.bash_profile
```

`bootstrap.sh` is idempotent and runs in order:

1. Symlinks dotfiles into `$HOME` (existing files are backed up to `*.bak.<timestamp>`).
2. Runs `mise install` using `.config/mise/config.toml`.
3. Activates mise, then fetches Anime4K shaders for mpv (skipped when already present; warn-only on failure).
4. Runs `npm ci` for each bundled extension in `.pi/agent/extensions/`.
5. Installs the pinned [Mononoki Nerd Font](https://github.com/ryanoasis/nerd-fonts)
   (`v3.5.1`) into `~/.local/share/fonts/` (skipped when already installed).

## 🧰 Tooling

`.config/mise/config.toml` is the source of truth for CLI tools.

```bash
mise upgrade    # upgrade installed tools
mise use -g <tool>  # add a new global tool
```

System upgrades are handled via the `topgrade` config in `.config/topgrade.toml`.

## 🗂️ What's managed

| Path                                                                                                   | Purpose                                                     |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `.bash_profile`, `.bashrc`, `.bashrc.d/`                                                               | Shell setup                                                 |
| `.config/ghostty`, `.config/lazygit`, `.config/mpv`, `.config/nvim`, `.config/yazi`, `.config/neovide` | App configs                                                 |
| `.config/mise`, `.config/topgrade.toml`                                                                | Tool / upgrade management                                   |
| `.pi/agent/`                                                                                           | Pi agent settings, keybindings, extensions, prompts, skills |
| `.gitconfig`                                                                                           | Git config                                                  |

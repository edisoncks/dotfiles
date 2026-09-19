# 🗃️ edisoncks's dotfiles

![Platform](https://img.shields.io/badge/platform-Linux-blue?logo=archlinux) ![GitHub last commit (branch)](https://img.shields.io/github/last-commit/edisoncks/dotfiles/main?logo=github)

## 🛠️ Prerequisites

1. Increase open file descriptor limit to at least 10240 before running the bootstrap script:

   ```bash
   ulimit -n 10240
   ```

## 📥 Getting started

Install packages and create symlinks. The script also installs the pinned
[Mononoki Nerd Font](https://github.com/ryanoasis/nerd-fonts) into
`~/.local/share/fonts/` and refreshes the font cache.

```bash
bash bootstrap.sh
# then, to apply in the current shell:
source ~/.bash_profile
```

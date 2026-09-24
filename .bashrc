# .bashrc

# Source global definitions
if [ -f /etc/bashrc ]; then
  . /etc/bashrc
fi

# User specific environment
case ":$PATH:" in
*":$HOME/bin:"*) ;;
*) PATH="$HOME/bin:$PATH" ;;
esac
case ":$PATH:" in
*":$HOME/.local/bin:"*) ;;
*) PATH="$HOME/.local/bin:$PATH" ;;
esac
export PATH

# Uncomment the following line if you don't like systemctl's auto-paging feature:
# export SYSTEMD_PAGER=

# User specific aliases and functions
if [ -d ~/.bashrc.d ]; then
  for rc in ~/.bashrc.d/*; do
    if [ -f "$rc" ]; then
      . "$rc"
    fi
  done
fi
unset rc

# Enable truecolor in Windows Terminal
if [ -n "$WT_SESSION" ] && [ -z "$COLORTERM" ]; then
  export COLORTERM=truecolor
fi

# Mise
if command -v mise >/dev/null 2>&1; then
  eval "$(mise activate bash)"
fi

# Starship
if command -v starship >/dev/null 2>&1; then
  eval "$(starship init bash)"
fi

# EDITOR (resolve via PATH; fall back to vi on minimal systems)
if command -v nvim >/dev/null 2>&1; then
  EDITOR=nvim
else
  EDITOR=vi
fi
export EDITOR

# OpenCode
if command -v opencode >/dev/null 2>&1; then
  export OPENCODE_ENABLE_EXA=1
fi

# Pi
if command -v pi >/dev/null 2>&1; then
  export PI_SKIP_VERSION_CHECK=1
fi

# fzf
if command -v fzf >/dev/null 2>&1; then
  eval "$(fzf --bash)"
fi

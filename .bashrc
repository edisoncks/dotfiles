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

# Homebrew
# Prioritize system binaries to prevent brew overriding things like dbus
HOMEBREW_PREFIX="${HOMEBREW_PREFIX:-/home/linuxbrew/.linuxbrew}"
case ":$PATH:" in
  *":$HOMEBREW_PREFIX/bin:"*) ;;
  *) PATH="$PATH:$HOMEBREW_PREFIX/bin" ;;
esac
case ":$PATH:" in
  *":$HOMEBREW_PREFIX/sbin:"*) ;;
  *) PATH="$PATH:$HOMEBREW_PREFIX/sbin" ;;
esac
export PATH
export HOMEBREW_NO_ASK=1
export HOMEBREW_NO_ANALYTICS=1

# Mise
if command -v mise >/dev/null 2>&1; then
  eval "$(mise activate bash)"
fi

# EDITOR
export EDITOR="$HOMEBREW_PREFIX/bin/nvim"

# OpenCode
export OPENCODE_ENABLE_EXA=1

# Pi
export PI_SKIP_VERSION_CHECK=1

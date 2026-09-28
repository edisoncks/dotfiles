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

# Shell integration: report the working directory via OSC 7 so that new
# tabs/panes inherit the current directory. OSC 7 is a generic terminal
# protocol (iTerm2, kitty, ghostty, foot, WezTerm, ...); terminals that don't
# understand it simply ignore the sequence. We only skip non-interactive shells
# and the terminals known to dislike OSC (dumb/linux).
# The path is percent-encoded byte by byte so that spaces, '#', '%', non-ASCII
# and even embedded control characters can't break out of the OSC sequence.
#
# ORDER MATTERS: keep this block AFTER mise/starship. Both rewrite
# PROMPT_COMMAND, and starship in particular *moves* any pre-existing
# PROMPT_COMMAND into $STARSHIP_PROMPT_COMMAND, replacing the visible value with
# just `starship_precmd` (the old value is re-eval'd from inside precmd). If we
# register before it, our hook is hidden from the de-dup check below, so a
# re-source would register it twice and emit OSC 7 twice per prompt. Placing it
# last keeps our function visible and the registration idempotent.
if [[ $- == *i* && "${TERM:-}" != "dumb" && "${TERM:-}" != "linux" ]]; then
  __shell_osc7() {
    local dir=$PWD out= c h i
    local LC_ALL=C
    for ((i = 0; i < ${#dir}; i++)); do
      c=${dir:i:1}
      case $c in
        [a-zA-Z0-9/._~-]) out+=$c ;;
        *) printf -v h '%%%02X' "'$c"; out+=$h ;;
      esac
    done
    printf '\033]7;file://%s%s\033\\' "${HOSTNAME:-localhost}" "$out"
  }
  # Compose with whatever PROMPT_COMMAND already holds (string or array),
  # and avoid stacking a duplicate if this file gets sourced more than once.
  if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
    [[ " ${PROMPT_COMMAND[*]} " == *" __shell_osc7 "* ]] || PROMPT_COMMAND=(__shell_osc7 "${PROMPT_COMMAND[@]}")
  else
    [[ "${PROMPT_COMMAND:-}" == *"__shell_osc7"* ]] || PROMPT_COMMAND="__shell_osc7${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
  fi
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

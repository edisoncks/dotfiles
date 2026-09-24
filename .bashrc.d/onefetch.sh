# onefetch.sh — show onefetch when entering the root of a git repository.
#
# PROMPT_COMMAND hook (bash >= 5.1) rather than a `cd` wrapper, so it also
# catches pushd/popd and helpers that use `builtin cd` (e.g. yazi's `y()`).
# No greeting on shell startup: the first prompt is considered "already here".

_onefetch_last_pwd=$PWD

_onefetch_on_cd() {
  # Interactive shell with a terminal only.
  [[ $- == *i* && -t 1 ]] || return 0

  # Act only when the directory actually changed.
  [[ $PWD == "${_onefetch_last_pwd-}" ]] && return 0
  _onefetch_last_pwd=$PWD

  # Cheap gate: a repo root has a .git entry (dir, or file for
  # worktrees/submodules). Skips virtually all non-repo directories.
  [[ -e $PWD/.git ]] || return 0

  command -v onefetch >/dev/null 2>&1 || return 0

  # Confirm this is the top level (git canonicalizes symlinks; -ef matches).
  local top
  top=$(command git rev-parse --show-toplevel 2>/dev/null) || return 0
  [[ $PWD -ef $top ]] || return 0

  # onefetch errors on repos without commits; skip them quietly.
  command git rev-parse --verify --quiet HEAD >/dev/null || return 0

  # Keep the report visually separate from the command that triggered it.
  printf '\n'
  command onefetch || true
}

# Register, preserving any existing PROMPT_COMMAND.
# Bash 5.1+ runs every array element; older bash only runs the scalar value /
# element 0, so write into element 0 there instead of appending a new element.
if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
  PROMPT_COMMAND=${PROMPT_COMMAND-}
  PROMPT_COMMAND+=(_onefetch_on_cd)
else
  # Drop trailing whitespace/semicolons so we never build an invalid ";;".
  PROMPT_COMMAND="${PROMPT_COMMAND%"${PROMPT_COMMAND##*[![:space:];]}"}"
  PROMPT_COMMAND="${PROMPT_COMMAND:+$PROMPT_COMMAND;}_onefetch_on_cd"
fi

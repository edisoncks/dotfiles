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

  command onefetch || true
}

# Register without clobbering an existing scalar or array PROMPT_COMMAND.
if [[ $(declare -p PROMPT_COMMAND 2>/dev/null) == "declare -a"* ]]; then
  PROMPT_COMMAND+=(_onefetch_on_cd)
else
  PROMPT_COMMAND="${PROMPT_COMMAND:+$PROMPT_COMMAND;}_onefetch_on_cd"
fi

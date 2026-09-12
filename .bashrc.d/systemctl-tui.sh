# Workaround for the following error.
# ncurses: cannot initialize terminal type ($TERM="xterm-ghostty"); exiting
# - sudo strips PATH, so resolve the mise binary at invocation time (not a
#   hardcoded /home/.../latest path, and not at source time: this file is
#   sourced before `mise activate` in ~/.bashrc).
# - root has no ghostty terminfo (verified missing for user+root), so remap
#   only *ghostty* TERMs to xterm-256color (present for user+root); all other
#   TERMs pass through untouched.
systemctl-tui() {
	local bin term
	bin=$(mise which systemctl-tui 2>/dev/null) || bin=$(type -P systemctl-tui 2>/dev/null) || {
		echo "systemctl-tui: not found (is mise installed?)" >&2
		return 127
	}
	case "${TERM:-}" in
		*ghostty*) term=xterm-256color ;;
		"") term=xterm-256color ;;
		*) term=$TERM ;;
	esac
	sudo env TERM="$term" "$bin" "$@"
}

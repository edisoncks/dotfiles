# Launch neovide detached (GUI): don't block shell, survive terminal close.
# Each invocation gets a uniquely-named screen session (auto-reaped on exit).
# Use `screen -r <session>` to view logs, `screen -ls | grep nv-` to list.
nv() {
	local sess
	command -v screen >/dev/null 2>&1 || {
		echo "nv: screen not found" >&2
		return 127
	}
	command -v neovide >/dev/null 2>&1 || {
		echo "nv: neovide not found" >&2
		return 127
	}
	sess="nv-$(date +%Y%m%d-%H%M%S)-$$"
	screen -dmS "$sess" neovide "$@"
	echo "neovide -> $sess (screen -r $sess for logs)"
}

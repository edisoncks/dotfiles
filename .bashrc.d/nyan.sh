# nyancat-cli has no --help/-h handling: both fall through to the animation
# (erroring with "stdout is not a terminal" when piped). Wrap the real binary
# so -h/--help prints usage; forward everything else unchanged.
nyan() {
  if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    cat <<'EOF'
nyan - Gruvbox Nyancat: terminal animation + 8-bit chiptune.

Usage: nyan [OPTIONS]

Options:
  --no-sound            Mute the soundtrack (animation only).
  --set-song <file>     Crunch <file> to 8-bit and install it as the
                        soundtrack. Needs afconvert (macOS) or a compatible
                        shim; accepts any audio format it can read
                        (mp3, m4a, wav, ...).
  -h, --help            Show this help message and exit.

Environment:
  NYANCAT_WAV           Path to a .wav soundtrack (takes precedence).

Soundtrack lookup order: $NYANCAT_WAV, then
$XDG_DATA_HOME/nyancat/nyan.wav (default ~/.local/share/nyancat/nyan.wav),
then ./nyan.wav, then alongside the installed program.

With no options, nyan plays the animation with sound when a soundtrack and
afplay are available. Press Ctrl-C to quit and restore the terminal.
EOF
    return 0
  fi

  # type -P (not command -v) finds the external binary, not this function.
  type -P nyan >/dev/null 2>&1 || {
    echo "nyan: command not found" >&2
    return 127
  }
  command nyan "$@"
}

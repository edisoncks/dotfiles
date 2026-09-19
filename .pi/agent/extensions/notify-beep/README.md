# notify-beep

A Pi extension that plays a short chime when the agent finishes or needs input. TUI only.

## Behavior

- Chimes when the agent is done (`agent_settled`)
- Chimes when Pi is waiting for your input (`ui_prompt_start`)
- Back-to-back events share one chime (1.5 s debounce)
- Overlapping playback is dropped (in-flight guard): a beep already playing
  for up to 2 s per player never stacks a second chain.
- Default is on when no config file exists.
- Chime cache is rendered synchronously at `session_start` (~0.5ms for 14KB,
  one write) so the first beep never pays render+write cost. Sync on purpose:
  an async warmup + join state machine costs more than it saves.

## Sound

- Plays a generated two-tone chime (`G4 → C5`, `notify-beep-chime.wav` cached
  in the agent dir) via the first
  *working* player: `pw-play` → `paplay` → `aplay` → `afplay` (macOS) → `mpv`
  (`mpv.exe` covers Windows). A player that is installed but broken
  (e.g. `pw-play` with no PipeWire server — exits non-zero instead of
  raising a spawn error) is skipped.
- On Windows with no player, falls back to a PowerShell two-tone beep
  (`pwsh` → `powershell`), then the terminal bell. Elsewhere falls back
  directly to the terminal bell.
- Chime is generated, never written next to source — cached as
  `<agent-dir>/notify-beep-chime.wav` with a single-file tmp fallback
  `$TMPDIR/pi-beep-<pid>.wav` (O_EXCL, unlinked+retried on EEXIST,
  else bell). No `mkdtemp` dir leak. Read-only agent dirs work.
- Override the sound file with `NOTIFY_BEEP_SOUND=/path/to/file`.
  Long overrides are SIGKILLed after 2 s per player and treated as handled
  (not cached as winner, no cascade through every player).
- Predictable output: 14156-byte WAV (`CHIME_LEN`), 22050 Hz mono 16-bit
  (see `chime.ts`). Explicit LE writes — same file on LE/BE, all OSes.
  Assert header/frames/peak in tests, not a hash: 1-LSB `Math.sin` drift
  across V8 is inaudible. Playback timbre still varies by audio stack.
- Windows note: `mpv` file playback is expected to cover `mpv.exe`, but
  needs a real Windows box to verify PATHEXT/`spawn` resolution. Bell
  fallback stays `stderr \x07`.

## Usage

- `/notify-beep` — toggle
- `/notify-beep on|off|toggle|status|test` (`test` force-plays to check audio, ignores on/off and debounce, never poisons the next real beep; dropped if a beep is already playing)

## Config

- `~/.pi/agent/notify-beep.json` as `{"enabled": true|false}` (respects custom agent dir)
- Created only on first `on`/`off`/`toggle`, never on `status` or load.
- A corrupt config (bad JSON, non-object, array, or non-boolean `enabled`)
  reads as enabled and is healed to `{"enabled": true}`
  at `session_start` with a `ui.notify` warning (never repaired at import).
- A failed persist (read-only agent dir) never crashes — it warns via
  `ui.notify` (`could not persist setting`), so the UI never lies about
  `on`/`off` across restarts.

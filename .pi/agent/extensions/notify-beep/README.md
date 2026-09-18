# notify-beep

A Pi extension that plays a short chime when the agent finishes or needs input. TUI only.

## Behavior

- Chimes when the agent is done (`agent_settled`)
- Chimes when Pi is waiting for your input (`ui_prompt_start`)
- Back-to-back events share one chime (1.5 s debounce)
- Default is on when no config file exists.

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
  `<agent-dir>/notify-beep-chime.wav` with a `mkdtemp` tmp fallback
  (else bell). Read-only install dirs work.
- Override the sound file with `NOTIFY_BEEP_SOUND=/path/to/file`.

## Usage

- `/notify-beep` — toggle
- `/notify-beep on|off|toggle|status|test` (`test` force-plays to check audio, ignores on/off and debounce)

## Config

- `~/.pi/agent/notify-beep.json` as `{"enabled": true|false}` (respects custom agent dir)
- Created only on first `on`/`off`/`toggle`, never on `status` or load.
- A corrupt config (bad JSON, non-object, array, or non-boolean `enabled`)
  reads as enabled and is healed to `{"enabled": true}`
  at `session_start` with a `ui.notify` warning (never repaired at import).

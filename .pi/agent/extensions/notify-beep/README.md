# notify-beep

A Pi extension that plays a short chime when the agent finishes or needs input. TUI only.

## Behavior

- Chimes when the agent is done (`agent_settled`)
- Chimes when Pi is waiting for your input (`ui_prompt_start`)
- Back-to-back events share one chime (1.5 s debounce)
- Default is on when no config file exists.

## Sound

- Plays a generated two-tone chime (`G4 → C5`, `beep.wav`) via the first
  available player: `pw-play` → `paplay` → `afplay` (macOS) → `mpv`.
- Falls back to the terminal bell when no player or sound file is available.
- `beep.wav` is generated, not tracked in git — regenerate with:
  `node scripts/generate-beep.mjs`
- Override the sound file with `NOTIFY_BEEP_SOUND=/path/to/file`.

## Usage

- `/notify-beep` — toggle
- `/notify-beep on|off|toggle|status`

## Config

- `~/.pi/agent/notify-beep.json` as `{"enabled": true|false}` (respects custom agent dir)
- Created only on first `on`/`off`/`toggle`, never on `status` or load.
- A corrupt config is reset to `{"enabled": true}` with a warning.

# notify-beep

A Pi extension that plays a short beep when the agent finishes or needs input. TUI only.

## Behavior

- Beeps when the agent is done (`agent_settled`)
- Beeps when Pi is waiting for your input (`ui_prompt_start`)
- Default is on when no config file exists.

## Usage

- `/notify-beep` — toggle
- `/notify-beep on|off|toggle|status`

## Config

- `~/.pi/agent/notify-beep.json` as `{"enabled": true|false}` (respects custom agent dir)
- Created only on first `on`/`off`/`toggle`, never on `status` or load.

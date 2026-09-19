# notify-beep

A Pi extension that plays a short chime when the agent finishes or needs input. TUI only.

See `ARCHITECTURE.md` for design rationale.

## Behavior

- Chimes when the agent is done (`agent_settled`)
- Chimes when Pi is waiting for your input (`ui_prompt_start`)
- Back-to-back events share one chime (1.5 s debounce)
- Overlapping playback is dropped
- Default is on when no config file exists.

## Sound

- Two-tone chime (`G4 → C5`), cached in the agent dir, played via the first
  working player: `pw-play` → `paplay` → `aplay` → `afplay` (macOS) → `mpv`,
  then PowerShell on Windows, then the terminal bell.
- Override the sound file with `NOTIFY_BEEP_SOUND=/path/to/file`.
- Over ssh, audio players are skipped and the terminal bell is used (it travels
  over ssh); set `NOTIFY_BEEP_SOUND` to force file playback.

## Usage

- `/notify-beep` — toggle
- `/notify-beep on|off|toggle|status|test` (`test` force-plays to check audio, ignores on/off and debounce, never poisons the next real beep; dropped if a beep is already playing)

## Config

- `~/.pi/agent/notify-beep.json` as `{"enabled": true|false}` (respects custom agent dir)
- Created only on first `on`/`off`/`toggle`, never on `status` or load.
- A corrupt config reads as enabled and is healed to `{"enabled": true}`
  at `session_start` with a warning.
- A failed persist never crashes — it warns, so the UI never lies about
  `on`/`off` across restarts.

## Docs

- `README.md` = user contract (what/usage/config). Keep 1-line behavior notes, no why.
- `ARCHITECTURE.md` = design rationale (audio chain, caching, config, chime bytes, concurrency, platform notes).
- Code `why` comments = source of truth; docs summarize and point at code, don't duplicate verbatim.
- Rule: behavior change updates README; why/how change updates `ARCHITECTURE.md` + code comment in the same commit.

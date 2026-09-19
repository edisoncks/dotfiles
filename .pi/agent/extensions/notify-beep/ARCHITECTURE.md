# notify-beep — Architecture

Design rationale for this extension. User contract lives in `README.md`;
code `why` comments in `index.ts` / `chime.ts` are the source of truth.
This file summarizes them — if it disagrees with code, code wins.

## Overview

- Fail-open, TUI-only notification. No IO at factory time; `session_start`
  is the single source of truth for config (`loadConfig` in `index.ts`).
- All playback paths are fire-and-forget and must never reject or crash
  the agent; every failure falls through to the terminal bell (`bell()`).

## Audio chain (`playCmd`, `orderedPlayers`, `powershellBeep`)

- Try order: `pw-play` → `paplay` → `aplay` → `afplay` (macOS only) → `mpv`,
  then PowerShell on Windows, then bell. First `ok` (exit 0) wins and is
  cached as `cachedPlayer` for next time.
- Spawn exit codes are authoritative. A missing binary reports as async
  `error` (ENOENT), not a sync throw — hence no `try/catch` around `spawn`.
  A broken-but-installed server (e.g. `pw-play` with PipeWire down) exits
  non-zero, so close codes are watched, not just `error` events.
- `mpv` is expected to cover `mpv.exe` on Windows, but PATHEXT/`spawn`
  resolution there still needs a real Windows box to verify.
- `NOTIFY_BEEP_SOUND` override is passed straight to players with no
  `existsSync` pre-check: check-then-spawn is TOCTOU theater (the file can
  vanish between check and spawn). A typo costs 5 fast fails, then bell.
- Over ssh (`SSH_CLIENT`/`SSH_TTY`/`SSH_CONNECTION`, see `isSshSession`)
  with no override, `beep()` bells directly and `session_start` skips cache
  warmup: a remote `ok` would play where nobody hears and suppress the bell
  that reaches the local emulator, plus litter the remote box. An explicit
  override bypasses this (user knows about audio forwarding); lazy cache
  creation covers an override exported mid-session. `test` follows the same
  path so it demonstrates what a real notification does.

## Caching + tmp fallback (`bundledSoundFile`, `ensureChimeSync`)

- Primary cache is `<agent-dir>/notify-beep-chime.wav` (respects custom
  agent dir). Source dir is never written to.
- Creation is authoritative via `wx` (O_EXCL): no check-then-write race.
  `EEXIST` means a prior run created it — reuse as-is. A corrupt cache
  just fails playback and falls back to bell.
- Fallback is a private `mkdtemp` dir (`$TMPDIR/pi-beep-XXX/chime.wav`,
  `0o600`) instead of a predictable PID filename, which would be a
  symlink-squatter target. Never unlink-on-`EEXIST`: never delete a file
  you didn't create — fail to bell instead.
- Tmp dir is cleaned best-effort on process `exit`. Reload-while-alive
  leaking one dir until exit is accepted (avoids cross-reload tracking).
- Warmup is synchronous at `session_start`: the chime is 14KB / one write /
  a few thousand `sin()` calls (~0.5ms). An async warmup + join state
  machine costs more complexity than it saves.

## Config (`loadConfig`, `saveEnabled`)

- Single parse, pure read: missing file = default on (not corrupt);
  bad JSON / non-object / array / non-boolean `enabled` = corrupt (heal to
  on at `session_start` with a warning, never at import).
- No `existsSync` gate: stat-then-read is TOCTOU — try the read, handle
  `ENOENT`/IO errors fail-open.
- Saves are atomic (tmp + rename) so a crash never leaves a half-file.
  Persist failures never crash; callers warn so the UI never lies about
  on/off across restarts. File is created only on `on`/`off`/`toggle`.

## Chime bytes (`chime.ts`)

- Generated two-tone `G4 → C5`, 22050 Hz mono 16-bit WAV (`CHIME_LEN`).
- Explicit per-sample `writeInt16LE`: portable, same bytes on LE/BE, no
  native-endian aliasing. Do not "optimize" to a bulk copy without a BE
  fallback.
- No SHA pin: 1-LSB `Math.sin` drift across V8 is inaudible. Assert
  header/frames/peak properties, not a hash.

## Concurrency (debounce, in-flight, timeouts)

- 1.5s debounce (`DEBOUNCE_MS`): back-to-back `agent_settled` /
  `ui_prompt_start` share one chime. `/notify-beep test` uses `force` to
  bypass debounce without poisoning the next real notification.
- In-flight guard (`isPlaying`): overlapping beeps are dropped —
  notification, not orchestra — so chains never stack.
- 2s per-player `SIGKILL` cap (`PLAY_TIMEOUT_MS`): our chime is 0.32s; 2s
  audible counts as handled (`timeout` stops the cascade but is never
  cached as winner, so long custom files don't poison player selection).
  `child.kill` to a just-exited pid can throw, hence that guard stays.
  `unref` on child + timer keeps fire-and-forget off the event loop.

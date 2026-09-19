import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderChime } from "./chime.js";

const STATE_FILE = "notify-beep.json";
const CHIME_FILE = "notify-beep-chime.wav";

// SSH detection: OpenSSH sets SSH_CLIENT + SSH_CONNECTION on every ssh
// session, SSH_TTY when a tty is allocated. Any one means "remote".
// Why bell over ssh: remote file players play where nobody hears (exit 0
// eats the bell that would have reached the local emulator — bell is just
// bytes over the wire). Explicit NOTIFY_BEEP_SOUND still wins.
function isSshSession(): boolean {
	return Boolean(process.env.SSH_CLIENT || process.env.SSH_TTY || process.env.SSH_CONNECTION);
}

function hasSoundOverride(): boolean {
	return Boolean(process.env.NOTIFY_BEEP_SOUND?.trim());
}

function statePath(): string | null {
	try {
		return join(getAgentDir(), STATE_FILE);
	} catch {
		// No agent dir: memory-only. Never fall back to a relative
		// path and litter the user's CWD with state files.
		return null;
	}
}

// Single parse: missing reads as on, corrupt reads as on + flags corrupt.
// Pure read: never writes, warns, or notifies.
// Why no existsSync: stat-then-read is TOCTOU. Try the read directly;
// ENOENT means "no config yet" (default on, not corrupt), parse/shape
// failure means corrupt. Other IO errors fail open without warning.
function loadConfig(): { enabled: boolean; corrupt: boolean } {
	const path = statePath();
	if (path === null) return { enabled: true, corrupt: false };
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch {
		// Missing file is the normal first-run case, not corruption.
		// EACCES etc. also fail open silently — never crash on persistence.
		return { enabled: true, corrupt: false };
	}
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return { enabled: true, corrupt: true };
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return { enabled: true, corrupt: true };
	}
	{
		const enabled = (raw as { enabled?: unknown }).enabled;
		if (enabled === undefined) return { enabled: true, corrupt: false };
		if (typeof enabled === "boolean") return { enabled, corrupt: false };
	}
	return { enabled: true, corrupt: true };
}

function saveEnabled(enabled: boolean): boolean {
	try {
		const path = statePath();
		if (path === null) return true;
		// Atomic save: tmp + rename so a crash never leaves a half-file.
		const tmp = `${path}.tmp`;
		writeFileSync(tmp, JSON.stringify({ enabled }, null, 2));
		renameSync(tmp, path);
		return true;
	} catch {
		// Persistence must never crash the agent. Caller warns.
		return false;
	}
}

const DEBOUNCE_MS = 1500;

function cachedChimePath(): string | null {
	try {
		return join(getAgentDir(), CHIME_FILE);
	} catch {
		return null;
	}
}

type Player = {
	readonly cmd: string;
	readonly args: readonly string[];
};

function isWindows(): boolean {
	return process.platform === "win32";
}

// Per-OS player lists: a missing binary fails fast (~ms), but skipping
// irrelevant spawns still cuts first-beep latency and process spam.
// Frozen: basePlayers() returns live refs, callers must not mutate.
// Winner is cached by cmd string (see cachedCmd), never by object
// identity, so these entries can be inlined without shared instances.
const PLAYERS_BY_OS: Record<"darwin" | "win32" | "default", readonly Player[]> = {
	darwin: Object.freeze([{ cmd: "afplay", args: ["{file}"] }, { cmd: "mpv", args: ["--no-video", "--really-quiet", "--no-terminal", "{file}"] }]),
	win32: Object.freeze([{ cmd: "mpv.exe", args: ["--no-video", "--really-quiet", "--no-terminal", "{file}"] }]),
	default: Object.freeze([
		{ cmd: "pw-play", args: ["{file}"] },
		{ cmd: "paplay", args: ["{file}"] },
		{ cmd: "aplay", args: ["-q", "{file}"] },
		{ cmd: "mpv", args: ["--no-video", "--really-quiet", "--no-terminal", "{file}"] },
	]),
};
Object.freeze(PLAYERS_BY_OS);

// Default covers linux + BSDs and any unknown unix: Pulse/PipeWire/ALSA
// names are portable enough there, mpv is the universal fallback.
function basePlayers(): readonly Player[] {
	if (process.platform === "darwin") return PLAYERS_BY_OS.darwin;
	if (isWindows()) return PLAYERS_BY_OS.win32;
	return PLAYERS_BY_OS.default;
}

function bell(): void {
	try {
		process.stderr.write("\u0007");
	} catch {
		// Terminal bell must never crash the agent.
	}
}

const PLAY_TIMEOUT_MS = 2000;

type PlayResult = "ok" | "fail" | "timeout";

// Runs cmd. ok = clean exit 0, fail = spawn error / non-zero exit,
// timeout = SIGKILLed after 2s (assume 2s audible was heard).
// Why no sync try/catch around spawn: a missing binary reports as an async
// "error" (ENOENT), not a sync throw — the "error" event is authoritative.
// A missing server (e.g. pw-play with PipeWire down) surfaces as a
// non-zero exit, not a spawn error, so watch close codes, not just errors.
function playCmd(cmd: string, args: string[]): Promise<PlayResult> {
	return new Promise((resolve) => {
		const child = spawn(cmd, args, { stdio: "ignore" });
		let settled = false;
		const done = (result: PlayResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(result);
		};
		// Never hang: our chime is 0.32s. Cap playback at 2s — 2s audible
		// is enough for a personal-use notification. Kill + treat as handled
		// (but not cacheable) so a long custom file doesn't cascade
		// through every player. Callers are fire-and-forget.
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			try {
				// Signaling a just-exited pid can throw; timeout still counts
				// as handled and this promise must never reject (fire-and-forget).
				child.kill("SIGKILL");
			} catch {
				// ignore
			}
			child.unref();
			resolve("timeout");
		}, PLAY_TIMEOUT_MS);
		// Fire-and-forget must not hold the event loop open.
		timer.unref();
		child.on("error", () => done("fail"));
		child.on("close", (code) => done(code === 0 ? "ok" : "fail"));
		child.unref();
	});
}

function playWith(player: Player, file: string): Promise<PlayResult> {
	return playCmd(
		player.cmd,
		player.args.map((a) => (a === "{file}" ? file : a)),
	);
}

// Win32-only fallback after file players, before the terminal bell.
// mpv.exe is the file player; this is last-resort synth for boxes
// with no player at all. Single command string, no quoting builder.
function powershellBeep(): Promise<boolean> {
	if (!isWindows()) return Promise.resolve(false);
	const args = ["-NoProfile", "-NonInteractive", "-Command", "[console]::beep(392,120); [console]::beep(523,180)"];
	return (async () => {
		// ok or timeout both count as handled (2s was heard); only fail tries next.
		if ((await playCmd("pwsh", args)) !== "fail") return true;
		if ((await playCmd("powershell", args)) !== "fail") return true;
		return false;
	})();
}

export default function (pi: ExtensionAPI) {
	// Fail-open default; no IO at factory time. session_start is the
	// single source of truth for config.
	let enabled = true;
	// Per-instance mutable state (no module globals): fresh on reload,
	// no stale winner/cache across extension reloads.
	let lastBeep = -Infinity;
	let bundledCache: string | undefined;
	let cachedCmd: string | undefined;
	let isPlaying = false;
	// True while a playback chain is in-flight. Overlapping beeps are
	// dropped (notification, not orchestra) to avoid stacking N×2s per-OS chains.

	function bundledSoundFile(): string | null {
		if (bundledCache !== undefined) return bundledCache;
		// Primary: persistent cache in agent dir (respects custom agent dir).
		// Source dir is immutable — never write next to index.ts.
		const cached = cachedChimePath();
		if (cached) {
			try {
				// Why wx + EEXIST-means-use: creation is authoritative, no
				// check-then-write race. A pre-existing cache is reused as-is;
				// a corrupt cache just fails playback and falls back to bell.
				writeFileSync(cached, renderChime(), { mode: 0o600, flag: "wx" });
				bundledCache = cached;
				return cached;
			} catch (e: unknown) {
				if ((e as NodeJS.ErrnoException)?.code === "EEXIST") {
					bundledCache = cached;
					return cached;
				}
				// Fall through to tmp fallback (e.g. read-only agent dir).
			}
		}
		// Fallback: private mkdtemp dir + fixed name. Why mkdtemp, not a
		// predictable $TMPDIR/pi-beep-<pid>.wav: predictable names are
		// symlink-squatter targets. Why never unlink-on-EEXIST: never delete
		// a file you didn't create — fail to bell instead. Why 0o600 + exit
		// cleanup: tmp is world-shared, keep private and leave no leak.
		// Accepted: reload-while-alive leaks one dir until process exit
		// (avoids module-global cross-reload tracking).
		try {
			const dir = mkdtempSync(join(tmpdir(), "pi-beep-"));
			const tmpFile = join(dir, "chime.wav");
			writeFileSync(tmpFile, renderChime(), { mode: 0o600, flag: "wx" });
			bundledCache = tmpFile;
			// Best-effort cleanup on normal exit; crash/kill may still leave
			// one tmp dir for the OS to reap — better than unlinking strangers.
			try {
				process.on("exit", () => {
					try {
						rmSync(dir, { recursive: true, force: true });
					} catch {
						// ignore — tmp reap is best-effort, never crash the agent.
					}
				});
			} catch {
				// ignore — leak one tmp dir rather than crash.
			}
			return tmpFile;
		} catch {
			// No cache on failure: retry next beep instead of bell-forever.
			return null;
		}
	}

	function soundFile(): string | null {
		const override = process.env.NOTIFY_BEEP_SOUND?.trim();
		if (override) {
			// Why no existsSync pre-check: it's TOCTOU theater — the file can
			// vanish between check and spawn anyway. Spawn exit codes are
			// authoritative; a typo'd override costs one fast fail per OS player then bell.
			return override;
		}
		return bundledSoundFile();
	}

	function orderedPlayers(): readonly Player[] {
		const available = basePlayers();
		if (cachedCmd !== undefined) {
			const hit = available.find((p) => p.cmd === cachedCmd);
			if (hit) return [hit, ...available.filter((p) => p !== hit)];
		}
		return available;
	}

	// Sync pre-warm of the agent-dir cache. Why sync: the chime is 14KB /
	// one write syscall / a few thousand sin() calls (~0.5ms). An async
	// warmup + join state machine costs more complexity than it saves.
	// Never throws (null on failure, beep falls back to bell).
	function ensureChimeSync(): string | null {
		try {
			return bundledSoundFile();
		} catch {
			return null;
		}
	}

	// Never rejects: all failures fall through to bell(), which is safe.
	function beep(opts?: { force?: boolean }): Promise<void> {
		const now = performance.now();
		if (!opts?.force) {
			if (now - lastBeep < DEBOUNCE_MS) return Promise.resolve();
			lastBeep = now;
		}
		// force: bypass debounce entirely and don't touch lastBeep,
		// so /notify-beep test never eats the next real notification.
		if (isPlaying) return Promise.resolve();
		isPlaying = true;
		return (async () => {
			try {
				// Over ssh with no override: a remote wav would play unheard
				// and suppress the bell that reaches the user. Bell directly.
				// Lazy cache still covers a late-exported override.
				if (isSshSession() && !hasSoundOverride()) {
					bell();
					return;
				}
				const file = soundFile();
				if (file) {
					for (const player of orderedPlayers()) {
						const result = await playWith(player, file);
						if (result === "ok") {
							cachedCmd = player.cmd;
							return;
						}
						// timeout: 2s heard so stop cascading, but don't cache
						// a wedged player as winner.
						if (result === "timeout") return;
					}
				}
				if (await powershellBeep()) return;
				bell();
			} catch {
				bell();
			} finally {
				isPlaying = false;
			}
		})();
	}

	pi.on("session_start", (_event, ctx) => {
		const cfg = loadConfig();
		if (cfg.corrupt) {
			const persisted = saveEnabled(true);
			ctx.ui.notify("[notify-beep] corrupt config reset to default (enabled)", "warning");
			if (!persisted) {
				ctx.ui.notify("[notify-beep] could not persist config (check agent dir permissions)", "warning");
			}
			enabled = true;
		} else {
			enabled = cfg.enabled;
		}
		// Sync cache warmup: ~0.5ms once per session, so the first beep never
		// pays render+write cost. Never throws, never blocks meaningfully.
		// Skipped over ssh with no override: we'd never play the file, so
		// don't litter the remote box (lazy creation covers a late override).
		if (!isSshSession() || hasSoundOverride()) {
			ensureChimeSync();
		}
	});

	const maybeBeep = (mode: unknown) => {
		if (!enabled) return;
		if (mode !== "tui") return;
		void beep();
	};

	pi.on("agent_settled", (_event, ctx) => {
		maybeBeep(ctx.mode);
	});

	pi.on("ui_prompt_start", (_event, ctx) => {
		maybeBeep(ctx.mode);
	});

	pi.registerCommand("notify-beep", {
		description: "Toggle notification beep when agent finishes or needs input",
		getArgumentCompletions: (prefix: string) => {
			const options = ["on", "off", "toggle", "status", "test"];
			return options.filter((o) => o.startsWith(prefix)).map((value) => ({ value, label: value }));
		},
		handler: async (args, ctx) => {
			const arg = (args || "").trim().toLowerCase();

			if (arg === "test") {
				// Bypass enabled + mode + debounce gates to exercise the audio chain.
				void beep({ force: true });
				ctx.ui.notify("beep test…", "info");
				return;
			}

			if (arg === "" || arg === "toggle") {
				enabled = !enabled;
			} else if (arg === "on") {
				enabled = true;
			} else if (arg === "off") {
				enabled = false;
			} else if (arg === "status") {
				ctx.ui.notify(enabled ? "beep: on" : "beep: off", "info");
				return;
			} else {
				ctx.ui.notify("Usage: /notify-beep [on|off|toggle|status|test]", "warning");
				return;
			}

			const persisted = saveEnabled(enabled);
			if (!persisted) {
				ctx.ui.notify("[notify-beep] could not persist setting (check agent dir permissions)", "warning");
				return;
			}
			ctx.ui.notify(enabled ? "beep: on" : "beep: off", "info");
		},
	});
}

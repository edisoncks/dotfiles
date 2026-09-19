import { spawn } from "node:child_process";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { access as accessAsync, writeFile as writeFileAsync } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderChime } from "./chime.js";

const STATE_FILE = "notify-beep.json";
const CHIME_FILE = "notify-beep-chime.wav";

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
function loadConfig(): { enabled: boolean; corrupt: boolean } {
	const path = statePath();
	if (path === null) return { enabled: true, corrupt: false };
	try {
		if (!existsSync(path)) return { enabled: true, corrupt: false };
		let raw: unknown;
		try {
			raw = JSON.parse(readFileSync(path, "utf8"));
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
	} catch {
		return { enabled: true, corrupt: false };
	}
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
	cmd: string;
	args: string[];
};

const PLAYERS: Player[] = [
	{ cmd: "pw-play", args: ["{file}"] },
	{ cmd: "paplay", args: ["{file}"] },
	{ cmd: "aplay", args: ["-q", "{file}"] },
	{ cmd: "afplay", args: ["{file}"] },
	{ cmd: "mpv", args: ["--no-video", "--really-quiet", "--no-terminal", "{file}"] },
];

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
// mpv.exe already covers Windows file playback; this is for boxes
// with no player at all. Single command string, no quoting builder.
function powershellBeep(): Promise<boolean> {
	if (process.platform !== "win32") return Promise.resolve(false);
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
	let cachedPlayer: Player | undefined;
	let isPlaying = false;
	// True while a playback chain is in-flight. Overlapping beeps are
	// dropped (notification, not orchestra) to avoid stacking 5×2s chains.
	// Background warmup so first beep doesn't pay sync render+write cost.
	// Never awaited by session_start (zero startup block); beep() awaits it.
	let warmupPromise: Promise<string | null> | null = null;

	function bundledSoundFile(): string | null {
		if (bundledCache !== undefined) return bundledCache;
		// Primary: persistent cache in agent dir (respects custom agent dir).
		// Source dir is immutable — never write next to index.ts.
		const cached = cachedChimePath();
		if (cached) {
			try {
				if (existsSync(cached)) {
					bundledCache = cached;
					return cached;
				}
				writeFileSync(cached, renderChime(), { mode: 0o600 });
				bundledCache = cached;
				return cached;
			} catch {
				// Fall through to tmp fallback.
			}
		}
		// Fallback: single tmp file, no mkdtemp dir leak. PID-suffixed + O_EXCL
		// (wx) so creation is authoritative: no check-then-use race, no
		// symlink clobber. EEXIST means stale PID-reuse or a squatter —
		// unlink once and retry, else bell (never trust an unknown file).
		const tmpFile = join(tmpdir(), `pi-beep-${process.pid}.wav`);
		try {
			writeFileSync(tmpFile, renderChime(), { mode: 0o600, flag: "wx" });
			bundledCache = tmpFile;
			return tmpFile;
		} catch (e: unknown) {
			if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") {
				// No cache on failure: retry next beep instead of bell-forever.
				return null;
			}
			try {
				unlinkSync(tmpFile);
			} catch {
				return null;
			}
			try {
				writeFileSync(tmpFile, renderChime(), { mode: 0o600, flag: "wx" });
				bundledCache = tmpFile;
				return tmpFile;
			} catch {
				return null;
			}
		}
	}

	function soundFile(): string | null {
		const override = process.env.NOTIFY_BEEP_SOUND?.trim();
		if (override) {
			// Fast-path filter for a typo'd override: skip 5 doomed spawns and
			// go straight to bell. TOCTOU-safe: worst case the file vanishes
			// between here and spawn, players fail, we bell anyway.
			// Player PATH lookup intentionally has no existsSync gate — spawn
			// exit codes are authoritative, avoiding check-then-spawn races.
			try {
				if (!existsSync(override)) return null;
			} catch {
				return null;
			}
			return override;
		}
		return bundledSoundFile();
	}

	function orderedPlayers(): Player[] {
		const available = PLAYERS.filter((p) => !(p.cmd === "afplay" && process.platform !== "darwin"));
		if (cachedPlayer && available.includes(cachedPlayer)) {
			return [cachedPlayer, ...available.filter((p) => p !== cachedPlayer)];
		}
		return available;
	}

	// Async pre-warm of the agent-dir cache. Same bytes as sync path,
	// but never blocks startup or the event loop. Tmp fallback stays
	// sync in bundledSoundFile() so beep() always has a path.
	async function ensureChimeAsync(): Promise<string | null> {
		if (bundledCache !== undefined) return bundledCache;
		const cached = cachedChimePath();
		if (!cached) return null;
		try {
			await accessAsync(cached);
			bundledCache = cached;
			return cached;
		} catch {
			// Missing: try to create it.
		}
		try {
			await writeFileAsync(cached, renderChime(), { mode: 0o600 });
			bundledCache = cached;
			return cached;
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
				// If background warmup is in-flight, join it instead of
				// duplicating the render+write synchronously.
				const warmup = warmupPromise;
				if (warmup) {
					try {
						await warmup;
					} catch {
						// Warmup never rejects (returns null), but stay safe.
					}
				}
				const file = soundFile();
				if (file) {
					for (const player of orderedPlayers()) {
						const result = await playWith(player, file);
						if (result === "ok") {
							cachedPlayer = player;
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
		// Fire-and-forget warmup: zero startup block. beep() awaits it.
		// ensureChimeAsync never rejects (null on failure).
		warmupPromise = ensureChimeAsync();
		warmupPromise.catch(() => null);
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

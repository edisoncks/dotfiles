import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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

function saveEnabled(enabled: boolean): void {
	try {
		const path = statePath();
		if (path === null) return;
		// Atomic save: tmp + rename so a crash never leaves a half-file.
		const tmp = `${path}.tmp`;
		writeFileSync(tmp, JSON.stringify({ enabled }, null, 2));
		renameSync(tmp, path);
	} catch {
		// Persistence must never crash the agent.
	}
}

const DEBOUNCE_MS = 1500;
let lastBeep = -Infinity;

let bundledCache: string | undefined;

function cachedChimePath(): string | null {
	try {
		return join(getAgentDir(), CHIME_FILE);
	} catch {
		return null;
	}
}

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
	// Fallback: single-use tmp file in a fresh mkdtemp dir (no predictable
	// /tmp name, no symlink race). Cached in memory only, not persistently.
	try {
		const dir = mkdtempSync(join(tmpdir(), "pi-beep-"));
		const tmpFile = join(dir, "chime.wav");
		writeFileSync(tmpFile, renderChime(), { mode: 0o600 });
		bundledCache = tmpFile;
		return tmpFile;
	} catch {
		// No cache on failure: retry next beep instead of bell-forever.
		return null;
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

function playWith(player: Player, file: string): Promise<PlayResult> {
	return playCmd(
		player.cmd,
		player.args.map((a) => (a === "{file}" ? file : a)),
	);
}

// Players known to work, cached winner first.
let cachedPlayer: Player | undefined;

function orderedPlayers(): Player[] {
	const available = PLAYERS.filter((p) => !(p.cmd === "afplay" && process.platform !== "darwin"));
	if (cachedPlayer && available.includes(cachedPlayer)) {
		return [cachedPlayer, ...available.filter((p) => p !== cachedPlayer)];
	}
	return available;
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
// A missing server (e.g. pw-play with PipeWire down) surfaces as a
// non-zero exit, not a spawn error, so watch close codes, not just errors.
function playCmd(cmd: string, args: string[]): Promise<PlayResult> {
	return new Promise((resolve) => {
		let child: ChildProcess | undefined;
		try {
			child = spawn(cmd, args, { stdio: "ignore" });
		} catch {
			resolve("fail");
			return;
		}
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
				child.kill("SIGKILL");
			} catch {
				// ignore
			}
			try {
				child.unref();
			} catch {
				// ignore
			}
			resolve("timeout");
		}, PLAY_TIMEOUT_MS);
		try {
			// Fire-and-forget must not hold the event loop open.
			timer.unref();
		} catch {
			// ignore
		}
		child.on("error", () => done("fail"));
		child.on("close", (code) => done(code === 0 ? "ok" : "fail"));
		try {
			child.unref();
		} catch {
			// ignore
		}
	});
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

// Never rejects: all failures fall through to bell(), which is safe.
function beep(opts?: { force?: boolean }): Promise<void> {
	const now = performance.now();
	if (!opts?.force && now - lastBeep < DEBOUNCE_MS) return Promise.resolve();
	lastBeep = now;
	return (async () => {
		try {
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
		}
	})();
}

export default function (pi: ExtensionAPI) {
	// Fail-open default; no IO at factory time. session_start is the
	// single source of truth for config.
	let enabled = true;

	pi.on("session_start", (_event, ctx) => {
		const cfg = loadConfig();
		if (cfg.corrupt) {
			saveEnabled(true);
			ctx.ui.notify("[notify-beep] corrupt config reset to default (enabled)", "warning");
			enabled = true;
		} else {
			enabled = cfg.enabled;
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

			saveEnabled(enabled);
			ctx.ui.notify(enabled ? "beep: on" : "beep: off", "info");
		},
	});
}

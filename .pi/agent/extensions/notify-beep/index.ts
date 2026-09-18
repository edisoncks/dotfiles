import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderChime } from "./chime.mjs";

const SOUND = fileURLToPath(new URL("./beep.wav", import.meta.url));
const STATE_FILE = "notify-beep.json";

function statePath(): string | null {
	try {
		return join(getAgentDir(), STATE_FILE);
	} catch {
		// No agent dir: memory-only. Never fall back to a relative
		// path and litter the user's CWD with state files.
		return null;
	}
}

// Pure read: never writes, warns, or notifies. Corrupt/missing reads as on.
function readEnabled(): boolean {
	const path = statePath();
	if (path === null) return true;
	try {
		if (!existsSync(path)) return true;
		let raw: unknown;
		try {
			raw = JSON.parse(readFileSync(path, "utf8"));
		} catch {
			raw = undefined;
		}
		if (typeof raw === "object" && raw !== null) {
			const enabled = (raw as { enabled?: unknown }).enabled;
			if (enabled === undefined) return true;
			if (typeof enabled === "boolean") return enabled;
		}
		return true;
	} catch {
		return true;
	}
}

function isCorrupt(): boolean {
	const path = statePath();
	if (path === null) return false;
	try {
		if (!existsSync(path)) return false;
		const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (typeof raw === "object" && raw !== null) {
			const enabled = (raw as { enabled?: unknown }).enabled;
			if (enabled === undefined || typeof enabled === "boolean") return false;
		}
		return true;
	} catch {
		return true;
	}
}

// Explicit repair, called only where ctx exists. Returns true when healed.
function repairConfigIfCorrupt(): boolean {
	if (!isCorrupt()) return false;
	saveEnabled(true);
	return true;
}

function saveEnabled(enabled: boolean): void {
	try {
		const path = statePath();
		if (path === null) return;
		writeFileSync(path, JSON.stringify({ enabled }, null, 2));
	} catch {
		// Persistence must never crash the agent.
	}
}

const DEBOUNCE_MS = 1500;
let lastBeep = 0;

let chimeEnsured = false;

function bundledSoundFile(): string | null {
	if (existsSync(SOUND)) return SOUND;
	if (chimeEnsured) return null;
	chimeEnsured = true;
	try {
		writeFileSync(SOUND, renderChime());
		return SOUND;
	} catch {
		return null;
	}
}

function soundFile(): string | null {
	const override = process.env.NOTIFY_BEEP_SOUND?.trim();
	if (override && existsSync(override)) return override;
	return bundledSoundFile();
}

type Player = {
	cmd: string;
	args: string[];
};

const PLAYERS: Player[] = [
	{ cmd: "pw-play", args: ["{file}"] },
	{ cmd: "paplay", args: ["{file}"] },
	{ cmd: "afplay", args: ["{file}"] },
	{ cmd: "mpv", args: ["--no-video", "--really-quiet", "--no-terminal", "{file}"] },
];

function buildArgs(player: Player, file: string): string[] {
	return player.args.map((a) => (a === "{file}" ? file : a));
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
		process.stdout.write("\u0007");
	} catch {
		// Terminal bell must never crash the agent.
	}
}

const PLAY_TIMEOUT_MS = 1500;

// Runs cmd. Resolves true when playback succeeds (exit 0).
// A missing server (e.g. pw-play with PipeWire down) surfaces as a
// non-zero exit, not a spawn error, so watch close codes, not just errors.
function playCmd(cmd: string, args: string[]): Promise<boolean> {
	return new Promise((resolve) => {
		let child;
		try {
			child = spawn(cmd, args, { stdio: "ignore" });
		} catch {
			resolve(false);
			return;
		}
		let settled = false;
		const done = (ok: boolean) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(ok);
		};
		// Never hang: our chime is 0.32s, so anything still running past
		// the timeout is a long custom file or wedged — kill it and
		// count it as handled. Callers are fire-and-forget.
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
			resolve(true);
		}, PLAY_TIMEOUT_MS);
		child.on("error", () => done(false));
		child.on("close", (code) => done(code === 0));
		try {
			child.unref();
		} catch {
			// ignore
		}
	});
}

function playWith(player: Player, file: string): Promise<boolean> {
	return playCmd(player.cmd, buildArgs(player, file));
}

// Win32-only fallback after file players, before the terminal bell.
// mpv.exe already covers Windows file playback; this is for boxes
// with no player at all. Single command string, no quoting builder.
function powershellBeep(): Promise<boolean> {
	if (process.platform !== "win32") return Promise.resolve(false);
	const args = ["-NoProfile", "-NonInteractive", "-Command", "[console]::beep(392,120); [console]::beep(523,180)"];
	return (async () => {
		if (await playCmd("pwsh", args)) return true;
		if (await playCmd("powershell", args)) return true;
		return false;
	})();
}

// Never rejects: all failures fall through to bell(), which is safe.
function beep(): Promise<void> {
	const now = performance.now();
	if (now - lastBeep < DEBOUNCE_MS) return Promise.resolve();
	lastBeep = now;
	return (async () => {
		try {
			const file = soundFile();
			if (file && existsSync(file)) {
				for (const player of orderedPlayers()) {
					if (await playWith(player, file)) {
						cachedPlayer = player;
						return;
					}
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
	let enabled = readEnabled();

	pi.on("session_start", (_event, ctx) => {
		if (repairConfigIfCorrupt()) {
			ctx.ui.notify("[notify-beep] corrupt config reset to default (enabled)", "warning");
		}
		enabled = readEnabled();
	});

	const maybeBeep = (mode: unknown) => {
		if (!enabled) return;
		if (mode !== "tui") return;
		void beep().catch(() => {});
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
			const options = ["on", "off", "toggle", "status"];
			return options.filter((o) => o.startsWith(prefix)).map((value) => ({ value, label: value }));
		},
		handler: async (args, ctx) => {
			const arg = (args || "").trim().toLowerCase();

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
				ctx.ui.notify("Usage: /notify-beep [on|off|toggle|status]", "warning");
				return;
			}

			saveEnabled(enabled);
			ctx.ui.notify(enabled ? "beep: on" : "beep: off", "info");
		},
	});
}

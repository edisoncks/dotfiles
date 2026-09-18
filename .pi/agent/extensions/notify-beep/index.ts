import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

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

function loadEnabled(): boolean {
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
		console.warn("[notify-beep] corrupt config at " + path + ", resetting to default (enabled)");
		saveEnabled(true);
		return true;
	} catch {
		return true;
	}
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

function statusText(enabled: boolean): string {
	return enabled ? "beep: on" : "beep: off";
}

const DEBOUNCE_MS = 1500;
let lastBeep = 0;

function soundFile(): string {
	const override = process.env.NOTIFY_BEEP_SOUND?.trim();
	if (override && existsSync(override)) return override;
	return SOUND;
}

interface Player {
	cmd: string;
	args: (file: string) => string[];
}

const PLAYERS: Player[] = [
	{ cmd: "pw-play", args: (f) => [f] },
	{ cmd: "paplay", args: (f) => [f] },
	{ cmd: "afplay", args: (f) => [f] },
	{ cmd: "mpv", args: (f) => ["--no-video", "--really-quiet", "--no-terminal", f] },
];

let cachedPlayer: Player | null | undefined;

function isExecutable(cmd: string): boolean {
	if (cmd === "afplay" && process.platform !== "darwin") return false;
	const delimiter = process.platform === "win32" ? ";" : ":";
	const names = process.platform === "win32" ? [cmd + ".exe", cmd + ".cmd", cmd + ".bat", cmd] : [cmd];
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		if (!dir) continue;
		for (const name of names) {
			try {
				accessSync(join(dir, name), constants.X_OK);
				return true;
			} catch {
				// Try the next candidate.
			}
		}
	}
	return false;
}

function resolvePlayer(): Player | null {
	if (cachedPlayer !== undefined) return cachedPlayer;
	cachedPlayer = PLAYERS.find((p) => isExecutable(p.cmd)) ?? null;
	return cachedPlayer;
}

function bell(): void {
	try {
		process.stdout.write("\u0007");
	} catch {
		// Terminal bell must never crash the agent.
	}
}

function beep(): void {
	const now = Date.now();
	if (now - lastBeep < DEBOUNCE_MS) return;
	lastBeep = now;
	try {
		const file = soundFile();
		if (!existsSync(file)) {
			bell();
			return;
		}
		const player = resolvePlayer();
		if (player === null) {
			bell();
			return;
		}
		const child = spawn(player.cmd, player.args(file), {
			detached: true,
			stdio: "ignore",
		});
		child.on("error", () => bell());
		child.unref();
	} catch {
		try {
			bell();
		} catch {
			// Notifications must never crash the agent.
		}
	}
}

export default function (pi: ExtensionAPI) {
	let enabled = loadEnabled();

	pi.on("session_start", async () => {
		enabled = loadEnabled();
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (!enabled) return;
		if (ctx.mode !== "tui") return;
		beep();
	});

	pi.on("ui_prompt_start", async (_event, ctx) => {
		if (!enabled) return;
		if (ctx.mode !== "tui") return;
		beep();
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
				ctx.ui.notify(statusText(enabled), "info");
				return;
			} else {
				ctx.ui.notify("Usage: /notify-beep [on|off|toggle|status]", "warning");
				return;
			}

			saveEnabled(enabled);
			ctx.ui.notify(statusText(enabled), "info");
		},
	});
}

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SOUND = fileURLToPath(new URL("./beep.mp3", import.meta.url));
const STATE_FILE = "notify-beep.json";

function statePath(): string {
	try {
		return join(getAgentDir(), STATE_FILE);
	} catch {
		return STATE_FILE;
	}
}

function loadEnabled(): boolean {
	try {
		const path = statePath();
		if (!existsSync(path)) return true;
		const raw = JSON.parse(readFileSync(path, "utf8")) as { enabled?: unknown };
		return raw.enabled === false ? false : true;
	} catch {
		return true;
	}
}

function saveEnabled(enabled: boolean): void {
	try {
		writeFileSync(statePath(), JSON.stringify({ enabled }, null, 2));
	} catch {
		// Persistence must never crash the agent.
	}
}

function statusText(enabled: boolean): string {
	return enabled ? "🔊 beep on" : "🔇 beep off";
}

function beep(): void {
	try {
		const child = spawn("mpv", ["--no-video", "--really-quiet", "--no-terminal", SOUND], {
			detached: true,
			stdio: "ignore",
		});
		child.on("error", () => {});
		child.unref();
	} catch {
		// Notifications must never crash the agent.
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
			const filtered = options.filter((o) => o.startsWith(prefix));
			return filtered.length > 0 ? filtered.map((value) => ({ value, label: value })) : null;
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

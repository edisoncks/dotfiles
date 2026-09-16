import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SOUND = fileURLToPath(new URL("./notification.mp3", import.meta.url));

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
	pi.on("agent_settled", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		beep();
	});

	pi.on("ui_prompt_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		beep();
	});
}

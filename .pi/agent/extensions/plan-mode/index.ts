/**
 * Plan Command Extension
 *
 * Registers /plan to enter PLAN MODE with proper newline preservation.
 * Replaces .pi/agent/prompts/plan.md to fix the $ARGUMENTS newline issue.
 *
 * Activation contract: plan mode is entered only when the input starts with
 * /plan. Anything before it (e.g. a pasted image path) is left untouched and
 * the message is sent to the model as-is.
 *
 * Usage:
 *   /plan Fix the login bug
 *   /plan
 *     Fix the login bug
 *     Also make sure to add tests
 *
 * Known limitations:
 * - pi -p / --mode json: sendUserMessage() is fire-and-forget and print mode
 *   disposes the session as soon as prompt() returns, so /plan is dropped.
 * - Queued input (steer/followUp, e.g. messages queued during compaction)
 *   does not emit the input event, so /plan\n... reaches the model raw.
 * - The command path cannot receive attached images, so RPC prompts that
 *   attach images to single-line "/plan ..." lose them; the input path
 *   forwards them.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PLAN_PROMPT = `Enter PLAN MODE (Plan → Revise → Review → Approve → Implementation) now and don't exit PLAN MODE until the plan is APPROVED or CANCELED.

---

`;

function isPlanInvocation(text: string): boolean {
  return /^\/plan(\s|$)/.test(text);
}

function extractTask(text: string): string {
  return text.slice("/plan".length).replace(/^\s+/, "");
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("plan", {
    description: "Enter PLAN MODE (Plan → Revise → Review → Approve → Implementation)",
    handler: async (args, ctx) => {
      // Strip leading whitespace (spaces, tabs, \r\n, \n)
      const task = (args || "").replace(/^\s+/, "");
      const message = PLAN_PROMPT + task;
      // Command handlers get no streamingBehavior. When the agent is busy,
      // queue as followUp (a requested "steer" cannot be honored here).
      pi.sendUserMessage(message, {
        deliverAs: ctx.isIdle() ? undefined : "followUp",
      });
    },
  });

  // Intercept /plan via input event for multi-line: /plan\nFix this.
  // Two dispatch paths, by design:
  // - "/plan foo" dispatches as the registered command; pi runs extension
  //   commands before the input event, so this handler is never reached.
  // - "/plan" followed by newline/tab misses command dispatch because the
  //   parser derives the command name with text.indexOf(" ")
  //   (_tryExecuteExtensionCommand in agent-session.js). It falls through to
  //   this handler, which forwards the task verbatim, newlines included.
  // Activation requires the input to start with "/plan" (isPlanInvocation);
  // text before it is ignored by design, not prepended or rewritten.
  pi.on("input", async (event) => {
    if (event.source === "extension") return { action: "continue" };
    if (!isPlanInvocation(event.text)) return { action: "continue" };

    // Extract raw arguments after /plan
    const task = extractTask(event.text);

    const message = PLAN_PROMPT + task;
    if (event.images?.length) {
      pi.sendUserMessage([{ type: "text", text: message }, ...event.images], {
        deliverAs: event.streamingBehavior,
      });
    } else {
      pi.sendUserMessage(message, { deliverAs: event.streamingBehavior });
    }
    return { action: "handled" };
  });
}

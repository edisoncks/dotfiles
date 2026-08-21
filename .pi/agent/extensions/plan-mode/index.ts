/**
 * Plan Command Extension
 *
 * Registers /plan to enter PLAN MODE with proper newline preservation.
 * Replaces .pi/agent/prompts/plan.md to fix the $ARGUMENTS newline issue.
 *
 * Usage:
 *   /plan Fix the login bug
 *   /plan
 *     Fix the login bug
 *     Also make sure to add tests
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PLAN_PROMPT = `Enter PLAN MODE (Plan → Revise → Review → Approve → Implementation) now and don't exit PLAN MODE until the plan is APPROVED or CANCELED.

---

`;

export default function (pi: ExtensionAPI) {
  pi.registerCommand("plan", {
    description: "Enter PLAN MODE (Plan → Revise → Review → Approve → Implementation)",
    handler: async (args) => {
      // Strip leading whitespace (spaces, tabs, \r\n, \n)
      const task = (args || "").replace(/^\s+/, "");
      const message = PLAN_PROMPT + task;
      pi.sendUserMessage(message);
    },
  });

  // Intercept /plan via input event for multi-line: /plan\nFix this
  // (command handler doesn't fire when input contains newline after /plan)

  // Intercept /plan via input event for full newline preservation
  pi.on("input", async (event) => {
    if (event.source === "extension") return { action: "continue" };
    if (!event.text.startsWith("/plan")) return { action: "continue" };

    // Extract raw arguments after /plan
    const args = event.text.slice("/plan".length);

    // Strip leading whitespace (spaces, tabs, \r\n, \n)
    const task = args.replace(/^\s+/, "");

    const message = PLAN_PROMPT + task;
    pi.sendUserMessage(message);
    return { action: "handled" };
  });
}

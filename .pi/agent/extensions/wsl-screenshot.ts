import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { spawnSync } from "child_process";
import { readFileSync } from "fs";

export default function (pi: ExtensionAPI) {
  // Enable/disable screenshot tool based on model vision capability
  const updateTool = (model: Model | undefined) => {
    const hasVision = model?.input?.includes("image") ?? false;
    const active = pi.getActiveTools();
    const toolName = "screenshot";

    if (hasVision && !active.includes(toolName)) {
      pi.setActiveTools([...active, toolName]);
    } else if (!hasVision && active.includes(toolName)) {
      pi.setActiveTools(active.filter((t) => t !== toolName));
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    updateTool(ctx.model);
  });

  pi.on("model_select", async (event) => {
    updateTool(event.model);
  });

  // Register the screenshot tool
  pi.registerTool({
    name: "screenshot",
    label: "Screenshot",
    description:
      "Take a screenshot of the Windows screen from WSL and save to /tmp",
    promptSnippet: "Capture the current Windows screen as an image",
    promptGuidelines: [
      "Use screenshot when the user asks to see or capture what's on their screen.",
      "Use screenshot when debugging visual issues or UI problems.",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal, onUpdate, ctx) {
      // Generate output path
      const filename = `screenshot-${Date.now()}.png`;
      const wslPath = `/tmp/${filename}`;

      // Convert to Windows path
      const winPathResult = spawnSync("wslpath", ["-w", wslPath], {
        timeout: 2000,
      });
      if (winPathResult.status !== 0) {
        return {
          content: [
            { type: "text", text: "Error: Failed to convert WSL path" },
          ],
          isError: true,
        };
      }
      const winPath = winPathResult.stdout.toString().trim();

      // PowerShell screenshot command
      const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen
        $bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size)
        $bitmap.Save('${winPath}')
        $graphics.Dispose()
        $bitmap.Dispose()
        Write-Output "$($screen.Bounds.Width)x$($screen.Bounds.Height)"
      `;

      // Execute PowerShell
      const result = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-Command", psScript],
        {
          timeout: 10000,
          encoding: "utf-8",
        },
      );

      if (result.status !== 0) {
        const stderr = result.stderr?.toString() || "Unknown error";
        return {
          content: [{ type: "text", text: `Screenshot failed: ${stderr}` }],
          isError: true,
        };
      }

      // Verify the file
      try {
        const buffer = readFileSync(wslPath);
        const dimensions = result.stdout?.trim() || "unknown";

        return {
          content: [
            {
              type: "text",
              text: `Screenshot saved to ${wslPath} (${dimensions}, ${buffer.length} bytes)`,
            },
          ],
          details: {
            path: wslPath,
            size: buffer.length,
            dimensions,
          },
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `Failed to read screenshot: ${err}` },
          ],
          isError: true,
        };
      }
    },
  });
}

/**
 * GET /run?skill=<name>
 *
 * Spawn a registered command and stream stdout/stderr as SSE.
 *
 * @example
 * import { createRunRoute } from "sna/server/routes/run";
 *
 * const runRoute = createRunRoute({
 *   status: [TSX, "src/scripts/sna.ts", "status"],
 *   collect: [TSX, "src/scripts/devlog.ts", "collect"],
 * });
 */

import { spawn } from "child_process";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";

const ROOT = process.cwd();

export function createRunRoute(commands: Record<string, string[]>) {
  return function runRoute(c: Context) {
    const skill = c.req.query("skill") ?? "";
    const cmd = commands[skill];

    if (!cmd) {
      return c.text(`data: unknown skill: ${skill}\n\ndata: [done]\n\n`, 200, {
        "Content-Type": "text/event-stream",
      });
    }

    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ data: `$ ${cmd.slice(1).join(" ")}` });

      const child = spawn(cmd[0], cmd.slice(1), {
        cwd: ROOT,
        env: { ...process.env, FORCE_COLOR: "0" },
      });

      const write = (chunk: Buffer) => {
        for (const line of chunk.toString().split("\n")) {
          if (line.trim()) stream.writeSSE({ data: line });
        }
      };

      child.stdout.on("data", write);
      child.stderr.on("data", (chunk: Buffer) => {
        for (const line of chunk.toString().split("\n")) {
          if (line.trim() && !line.startsWith(">")) stream.writeSSE({ data: line });
        }
      });

      await new Promise<void>((resolve) => {
        child.on("close", async (code) => {
          await stream.writeSSE({ data: `[exit ${code ?? 0}]` });
          await stream.writeSSE({ data: "[done]" });
          resolve();
        });

        child.on("error", async (err) => {
          await stream.writeSSE({ data: `Error: ${err.message}` });
          await stream.writeSSE({ data: "[done]" });
          resolve();
        });
      });
    });
  };
}

import { spawn } from "child_process";
import { streamSSE } from "hono/streaming";
const ROOT = process.cwd();
function createRunRoute(commands) {
  return function runRoute(c) {
    const skill = c.req.query("skill") ?? "";
    const cmd = commands[skill];
    if (!cmd) {
      return c.text(`data: unknown skill: ${skill}

data: [done]

`, 200, {
        "Content-Type": "text/event-stream"
      });
    }
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ data: `$ ${cmd.slice(1).join(" ")}` });
      const child = spawn(cmd[0], cmd.slice(1), {
        cwd: ROOT,
        env: { ...process.env, FORCE_COLOR: "0" }
      });
      const write = (chunk) => {
        for (const line of chunk.toString().split("\n")) {
          if (line.trim()) stream.writeSSE({ data: line });
        }
      };
      child.stdout.on("data", write);
      child.stderr.on("data", (chunk) => {
        for (const line of chunk.toString().split("\n")) {
          if (line.trim() && !line.startsWith(">")) stream.writeSSE({ data: line });
        }
      });
      await new Promise((resolve) => {
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
export {
  createRunRoute
};

import { spawn } from "child_process";
const runtime = "nodejs";
const ROOT = process.cwd();
function createRunHandler(commands) {
  return async function GET(req) {
    const skill = req.nextUrl.searchParams.get("skill") ?? "";
    const cmd = commands[skill];
    if (!cmd) {
      return new Response(`data: unknown skill: ${skill}

data: [done]

`, {
        headers: { "Content-Type": "text/event-stream" }
      });
    }
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const send = (line) => {
          controller.enqueue(encoder.encode(`data: ${line}

`));
        };
        send(`$ ${cmd.slice(1).join(" ")}`);
        const child = spawn(cmd[0], cmd.slice(1), {
          cwd: ROOT,
          env: { ...process.env, FORCE_COLOR: "0" }
        });
        child.stdout.on("data", (chunk) => {
          for (const line of chunk.toString().split("\n")) {
            if (line.trim()) send(line);
          }
        });
        child.stderr.on("data", (chunk) => {
          for (const line of chunk.toString().split("\n")) {
            if (line.trim() && !line.startsWith(">")) send(line);
          }
        });
        child.on("close", (code) => {
          send(`[exit ${code ?? 0}]`);
          send("[done]");
          controller.close();
        });
        child.on("error", (err) => {
          send(`Error: ${err.message}`);
          send("[done]");
          controller.close();
        });
      }
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      }
    });
  };
}
export {
  createRunHandler,
  runtime
};

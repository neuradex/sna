import { spawn } from "child_process";
import path from "path";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

// process.cwd() is the project root when Next.js runs
const ROOT = process.cwd();

const TSX = path.join(ROOT, "node_modules/.bin/tsx");

const ALLOWED_COMMANDS: Record<string, string[]> = {
  collect: [TSX, "src/scripts/devlog.ts", "collect"],
  stats:   [TSX, "src/scripts/devlog.ts", "stats"],
  export:  [TSX, "src/scripts/devlog.ts", "export"],
  status:  [TSX, "src/scripts/sna.ts",    "status"],
};

export async function GET(req: NextRequest) {
  const skill = req.nextUrl.searchParams.get("skill") ?? "";
  const cmd = ALLOWED_COMMANDS[skill];

  if (!cmd) {
    return new Response(`data: unknown skill: ${skill}\n\ndata: [done]\n\n`, {
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (line: string) => {
        controller.enqueue(encoder.encode(`data: ${line}\n\n`));
      };

      send(`$ ${cmd.slice(1).join(" ")}`);

      const child = spawn(cmd[0], cmd.slice(1), {
        cwd: ROOT,
        env: { ...process.env, FORCE_COLOR: "0" },
      });

      child.stdout.on("data", (chunk: Buffer) => {
        const lines = chunk.toString().split("\n");
        for (const line of lines) {
          if (line.trim()) send(line);
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        const lines = chunk.toString().split("\n");
        for (const line of lines) {
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
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

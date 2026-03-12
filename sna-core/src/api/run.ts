/**
 * createRunHandler — factory for the /api/run SSE endpoint.
 *
 * Pass a map of allowed commands for your app. Each key is a skill name,
 * each value is the argv array to spawn (first element is the binary).
 *
 * @example
 * // src/app/api/run/route.ts
 * import path from "path";
 * import { createRunHandler } from "sna/api/run";
 *
 * const ROOT = process.cwd();
 * const TSX = path.join(ROOT, "node_modules/.bin/tsx");
 * const SNA_CORE = path.join(ROOT, "node_modules/sna");
 *
 * export const GET = createRunHandler({
 *   status: [TSX, path.join(SNA_CORE, "src/scripts/lna.ts"), "status"],
 *   collect: [TSX, "src/scripts/devlog.ts", "collect"],
 * });
 */

import { spawn } from "child_process";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

const ROOT = process.cwd();

export function createRunHandler(commands: Record<string, string[]>) {
  return async function GET(req: NextRequest) {
    const skill = req.nextUrl.searchParams.get("skill") ?? "";
    const cmd = commands[skill];

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
          for (const line of chunk.toString().split("\n")) {
            if (line.trim()) send(line);
          }
        });

        child.stderr.on("data", (chunk: Buffer) => {
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
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  };
}

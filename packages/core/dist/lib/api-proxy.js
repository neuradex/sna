import http from "http";
import https from "https";
import { URL } from "url";
async function startApiProxy(opts = {}) {
  const targetBase = opts.targetBaseUrl ?? "https://api.anthropic.com";
  let systemPrompt = null;
  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      });
      res.end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks);
    if (req.method === "POST" && req.url?.startsWith("/v1/messages")) {
      try {
        const body = JSON.parse(rawBody.toString());
        if (body.system) systemPrompt = body.system;
        opts.onRequest?.({
          model: body.model ?? "unknown",
          stream: !!body.stream,
          system: body.system ?? null,
          messages: body.messages ?? null,
          messageCount: body.messages?.length ?? 0
        });
      } catch {
      }
    }
    const target = new URL(req.url ?? "/", targetBase);
    const isHttps = target.protocol === "https:";
    const transport = isHttps ? https : http;
    const headers = {};
    for (const [key, val] of Object.entries(req.headers)) {
      if (key.toLowerCase() === "host") continue;
      if (val) headers[key] = Array.isArray(val) ? val.join(", ") : val;
    }
    headers["host"] = target.host;
    const proxyReq = transport.request(
      {
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: target.pathname + target.search,
        method: req.method,
        headers
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );
    proxyReq.on("error", (err) => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `proxy error: ${err.message}` }));
    });
    proxyReq.end(rawBody);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        port,
        server,
        close: () => server.close(),
        get systemPrompt() {
          return systemPrompt;
        }
      });
    });
  });
}
export {
  startApiProxy
};

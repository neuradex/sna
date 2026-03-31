import http from "http";
function ts() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(11, 23);
}
async function startMockAnthropicServer() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    console.log(`[${ts()}] ${req.method} ${req.url} ${req.headers["content-type"] ?? ""}`);
    if (req.method === "OPTIONS") {
      res.writeHead(200, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" });
      res.end();
      return;
    }
    if (req.method === "POST" && req.url?.startsWith("/v1/messages")) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const rawBody = Buffer.concat(chunks).toString();
      let body;
      try {
        body = JSON.parse(rawBody);
      } catch (e) {
        console.log(`[${ts()}] ERROR: invalid JSON body: ${rawBody.slice(0, 200)}`);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON" }));
        return;
      }
      const entry = { model: body.model, messages: body.messages, stream: body.stream, timestamp: (/* @__PURE__ */ new Date()).toISOString() };
      requests.push(entry);
      const lastUser = body.messages?.filter((m) => m.role === "user").pop();
      const userText = typeof lastUser?.content === "string" ? lastUser.content : lastUser?.content?.find((b) => b.type === "text")?.text ?? "(no text)";
      console.log(`[${ts()}] REQ model=${body.model} stream=${body.stream} messages=${body.messages?.length} user="${userText.slice(0, 120)}"`);
      const replyText = `Mock reply to: ${userText.slice(0, 100)}`;
      const messageId = `msg_mock_${Date.now()}`;
      if (body.stream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive"
        });
        const send = (event, data) => {
          res.write(`event: ${event}
data: ${JSON.stringify(data)}

`);
        };
        send("message_start", {
          type: "message_start",
          message: {
            id: messageId,
            type: "message",
            role: "assistant",
            model: body.model,
            content: [],
            stop_reason: null,
            usage: { input_tokens: 100, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
          }
        });
        send("content_block_start", {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" }
        });
        const words = replyText.split(" ");
        for (const word of words) {
          send("content_block_delta", {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: word + " " }
          });
        }
        send("content_block_stop", { type: "content_block_stop", index: 0 });
        send("message_delta", {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: words.length * 2 }
        });
        send("message_stop", { type: "message_stop" });
        res.end();
        console.log(`[${ts()}] RES stream complete reply="${replyText.slice(0, 80)}"`);
      } else {
        const response = {
          id: messageId,
          type: "message",
          role: "assistant",
          model: body.model,
          content: [{ type: "text", text: replyText }],
          stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
        console.log(`[${ts()}] RES json reply="${replyText.slice(0, 80)}"`);
      }
      return;
    }
    console.log(`[${ts()}] 404 ${req.method} ${req.url}`);
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  });
  return new Promise((resolve) => {
    server.listen(0, () => {
      const port = server.address().port;
      console.log(`[${ts()}] Mock Anthropic API server listening on :${port}`);
      resolve({
        port,
        server,
        close: () => {
          console.log(`[${ts()}] Mock API server shutting down`);
          server.close();
        },
        requests
      });
    });
  });
}
export {
  startMockAnthropicServer
};

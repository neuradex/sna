function httpJson(c, _op, data, status) {
  return c.json(data, status);
}
function wsReply(ws, msg, data) {
  if (ws.readyState !== ws.OPEN) return;
  const out = { ...data, type: msg.type };
  if (msg.rid != null) out.rid = msg.rid;
  ws.send(JSON.stringify(out));
}
export {
  httpJson,
  wsReply
};

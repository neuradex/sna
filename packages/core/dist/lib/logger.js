import fs from "fs";
import path from "path";
const LOG_PATH = path.join(process.cwd(), ".dev.log");
try {
  fs.writeFileSync(LOG_PATH, "");
} catch {
}
function ts() {
  return (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
const tags = {
  sna: " SNA ",
  req: " REQ ",
  agent: " AGT ",
  stdin: " IN  ",
  stdout: " OUT ",
  route: " API ",
  ws: " WS  ",
  err: " ERR "
};
function appendFile(tag, args) {
  const line = `${ts()} ${tag} ${args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}
`;
  fs.appendFile(LOG_PATH, line, () => {
  });
}
function log(tag, ...args) {
  console.log(`${ts()} ${tags[tag] ?? tag}`, ...args);
  appendFile(tags[tag] ?? tag, args);
}
function err(tag, ...args) {
  console.error(`${ts()} ${tags[tag] ?? tag}`, ...args);
  appendFile(tags[tag] ?? tag, args);
}
const logger = { log, err };
export {
  logger
};

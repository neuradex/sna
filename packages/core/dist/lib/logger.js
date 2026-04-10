import fs from "fs";
import path from "path";
const LOG_PATH = process.env.SNA_LOG_PATH ?? path.join(process.cwd(), ".dev.log");
try {
  fs.writeFileSync(LOG_PATH, "");
} catch {
}
let _onLog = null;
function setOnLog(cb) {
  _onLog = cb;
}
let _logLevel = "info";
function setLogLevel(level) {
  _logLevel = level;
}
const TAG_LEVELS = {
  err: "error",
  sna: "warn",
  agent: "warn",
  ws: "warn",
  req: "info",
  stdin: "info",
  stdout: "info",
  route: "info"
};
const LEVEL_ORDER = { info: 0, warn: 1, error: 2, silent: 3 };
function shouldEmit(tag) {
  if (_logLevel === "silent") return false;
  const tagMinLevel = TAG_LEVELS[tag] ?? "info";
  return LEVEL_ORDER[tagMinLevel] >= LEVEL_ORDER[_logLevel];
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
function formatLine(tag, args) {
  return `${ts()} ${tag} ${args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}`;
}
function appendFile(tag, args) {
  const line = formatLine(tag, args) + "\n";
  fs.appendFile(LOG_PATH, line, () => {
  });
}
function log(tag, ...args) {
  const resolvedTag = tags[tag] ?? tag;
  appendFile(resolvedTag, args);
  if (!shouldEmit(tag)) return;
  if (_onLog) {
    _onLog(formatLine(resolvedTag, args));
  } else {
    console.log(`${ts()} ${resolvedTag}`, ...args);
  }
}
function err(tag, ...args) {
  const resolvedTag = tags[tag] ?? tag;
  appendFile(resolvedTag, args);
  if (!shouldEmit(tag)) return;
  if (_onLog) {
    _onLog(formatLine(resolvedTag, args));
  } else {
    console.error(`${ts()} ${resolvedTag}`, ...args);
  }
}
const logger = { log, err, setOnLog, setLogLevel };
export {
  logger
};

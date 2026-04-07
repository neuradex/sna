import fs from "fs";
import path from "path";

const LOG_PATH = process.env.SNA_LOG_PATH ?? path.join(process.cwd(), ".dev.log");

// Truncate on startup (skip if path is not writable, e.g. Electron prod with cwd=/)
try { fs.writeFileSync(LOG_PATH, ""); } catch { /* ok */ }

/**
 * External log callback — when set, logger output is routed through this
 * callback instead of console.log/console.error. This allows in-process
 * consumers (Electron) to capture ALL SNA SDK log output via the onLog
 * callback passed to startSnaServerInProcess().
 */
let _onLog: ((line: string) => void) | null = null;

/** Set the external log callback. Pass null to revert to console output. */
function setOnLog(cb: ((line: string) => void) | null): void {
  _onLog = cb;
}

function ts(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const tags: Record<string, string> = {
  sna: " SNA ", req: " REQ ", agent: " AGT ", stdin: " IN  ",
  stdout: " OUT ", route: " API ", ws: " WS  ", err: " ERR ",
};

type Tag = keyof typeof tags;

function formatLine(tag: string, args: unknown[]): string {
  return `${ts()} ${tag} ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}`;
}

function appendFile(tag: string, args: unknown[]) {
  const line = formatLine(tag, args) + "\n";
  fs.appendFile(LOG_PATH, line, () => {});
}

function log(tag: Tag, ...args: unknown[]) {
  const resolvedTag = tags[tag] ?? tag;
  if (_onLog) {
    _onLog(formatLine(resolvedTag, args));
  } else {
    console.log(`${ts()} ${resolvedTag}`, ...args);
  }
  appendFile(resolvedTag, args);
}

function err(tag: Tag, ...args: unknown[]) {
  const resolvedTag = tags[tag] ?? tag;
  if (_onLog) {
    _onLog(formatLine(resolvedTag, args));
  } else {
    console.error(`${ts()} ${resolvedTag}`, ...args);
  }
  appendFile(resolvedTag, args);
}

export const logger = { log, err, setOnLog };

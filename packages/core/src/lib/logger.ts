import fs from "fs";
import path from "path";

const LOG_PATH = path.join(process.cwd(), ".dev.log");

// Truncate on startup
try { fs.writeFileSync(LOG_PATH, ""); } catch { /* ok */ }

function ts(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const tags: Record<string, string> = {
  sna: " SNA ", req: " REQ ", agent: " AGT ", stdin: " IN  ",
  stdout: " OUT ", route: " API ", ws: " WS  ", err: " ERR ",
};

type Tag = keyof typeof tags;

function appendFile(tag: string, args: unknown[]) {
  const line = `${ts()} ${tag} ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}\n`;
  fs.appendFile(LOG_PATH, line, () => {});
}

function log(tag: Tag, ...args: unknown[]) {
  console.log(`${ts()} ${tags[tag] ?? tag}`, ...args);
  appendFile(tags[tag] ?? tag, args);
}

function err(tag: Tag, ...args: unknown[]) {
  console.error(`${ts()} ${tags[tag] ?? tag}`, ...args);
  appendFile(tags[tag] ?? tag, args);
}

export const logger = { log, err };

import chalk from "chalk";
import fs from "fs";
import path from "path";

const LOG_PATH = path.join(process.cwd(), ".dev.log");

// Truncate on startup
try { fs.writeFileSync(LOG_PATH, ""); } catch { /* ok */ }

function tsPlain(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function tsColored(): string {
  return chalk.gray(tsPlain());
}

const tags = {
  sna:    chalk.bold.magenta(" SNA "),
  req:    chalk.bold.blue(" REQ "),
  agent:  chalk.bold.cyan(" AGT "),
  stdin:  chalk.bold.green(" IN  "),
  stdout: chalk.bold.yellow(" OUT "),
  route:  chalk.bold.blue(" API "),
  err:    chalk.bold.red(" ERR "),
} as const;

const tagPlain: Record<string, string> = {
  sna: " SNA ", req: " REQ ", agent: " AGT ", stdin: " IN  ",
  stdout: " OUT ", route: " API ", err: " ERR ",
};

type Tag = keyof typeof tags;

function appendFile(tag: string, args: unknown[]) {
  const line = `${tsPlain()} ${tag} ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}\n`;
  fs.appendFile(LOG_PATH, line, () => {});
}

function log(tag: Tag, ...args: unknown[]) {
  console.log(`${tsColored()} ${tags[tag]}`, ...args);
  appendFile(tagPlain[tag], args);
}

function err(tag: Tag, ...args: unknown[]) {
  console.error(`${tsColored()} ${tags[tag]}`, ...args);
  appendFile(tagPlain[tag], args);
}

export const logger = { log, err };

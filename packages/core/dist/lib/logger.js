import chalk from "chalk";
import fs from "fs";
import path from "path";
const LOG_PATH = path.join(process.cwd(), ".dev.log");
try {
  fs.writeFileSync(LOG_PATH, "");
} catch {
}
function tsPlain() {
  return (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function tsColored() {
  return chalk.gray(tsPlain());
}
const tags = {
  sna: chalk.bold.magenta(" SNA "),
  req: chalk.bold.blue(" REQ "),
  agent: chalk.bold.cyan(" AGT "),
  stdin: chalk.bold.green(" IN  "),
  stdout: chalk.bold.yellow(" OUT "),
  route: chalk.bold.blue(" API "),
  err: chalk.bold.red(" ERR ")
};
const tagPlain = {
  sna: " SNA ",
  req: " REQ ",
  agent: " AGT ",
  stdin: " IN  ",
  stdout: " OUT ",
  route: " API ",
  err: " ERR "
};
function appendFile(tag, args) {
  const line = `${tsPlain()} ${tag} ${args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}
`;
  fs.appendFile(LOG_PATH, line, () => {
  });
}
function log(tag, ...args) {
  console.log(`${tsColored()} ${tags[tag]}`, ...args);
  appendFile(tagPlain[tag], args);
}
function err(tag, ...args) {
  console.error(`${tsColored()} ${tags[tag]}`, ...args);
  appendFile(tagPlain[tag], args);
}
const logger = { log, err };
export {
  logger
};

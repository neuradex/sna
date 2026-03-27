import chalk from "chalk";

function ts(): string {
  return chalk.gray(new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }));
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

type Tag = keyof typeof tags;

function log(tag: Tag, ...args: unknown[]) {
  console.log(`${ts()} ${tags[tag]}`, ...args);
}

function err(tag: Tag, ...args: unknown[]) {
  console.error(`${ts()} ${tags[tag]}`, ...args);
}

export const logger = { log, err };

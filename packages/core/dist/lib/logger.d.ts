/** Set the external log callback. Pass null to revert to console output. */
declare function setOnLog(cb: ((line: string) => void) | null): void;
type LogLevel = "info" | "warn" | "error" | "silent";
/** Set the log level. File recording is unaffected — only callback/console output is filtered. */
declare function setLogLevel(level: LogLevel): void;
declare const tags: Record<string, string>;
type Tag = keyof typeof tags;
declare function log(tag: Tag, ...args: unknown[]): void;
declare function err(tag: Tag, ...args: unknown[]): void;
declare const logger: {
    log: typeof log;
    err: typeof err;
    setOnLog: typeof setOnLog;
    setLogLevel: typeof setLogLevel;
};

export { type LogLevel, logger };

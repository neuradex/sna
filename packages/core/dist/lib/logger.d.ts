declare const tags: Record<string, string>;
type Tag = keyof typeof tags;
declare function log(tag: Tag, ...args: unknown[]): void;
declare function err(tag: Tag, ...args: unknown[]): void;
declare const logger: {
    log: typeof log;
    err: typeof err;
};

export { logger };

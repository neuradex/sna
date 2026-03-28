declare const tags: {
    readonly sna: string;
    readonly req: string;
    readonly agent: string;
    readonly stdin: string;
    readonly stdout: string;
    readonly route: string;
    readonly err: string;
};
type Tag = keyof typeof tags;
declare function log(tag: Tag, ...args: unknown[]): void;
declare function err(tag: Tag, ...args: unknown[]): void;
declare const logger: {
    log: typeof log;
    err: typeof err;
};

export { logger };

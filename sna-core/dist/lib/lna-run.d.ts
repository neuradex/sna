/**
 * lna-run — Awaitable skill invocation for LNA pipelines.
 *
 * Lets you chain Claude Code skills programmatically using async/await.
 *
 * @example
 * import { lna } from "lna/lib/lna-run";
 *
 * await lna.run("/devlog-collect");
 * await lna.run("/devlog-analyze --week");
 * await lna.run("/devlog-report");
 */
declare const lna: {
    /**
     * Invoke a Claude Code skill by slash command and await its completion.
     *
     * @param command - e.g. "/devlog-collect --since 7d"
     * @param opts.timeout - Max wait time in ms (default: 5 minutes)
     */
    run: (command: string, opts?: {
        timeout?: number;
    }) => Promise<void>;
};

export { lna };

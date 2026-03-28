/**
 * sna-run — Awaitable skill invocation for SNA pipelines.
 *
 * Lets you chain Claude Code skills programmatically using async/await.
 *
 * @example
 * import { sna } from "sna/lib/sna-run";
 *
 * await sna.run("/devlog-collect");
 * await sna.run("/devlog-analyze --week");
 * await sna.run("/devlog-report");
 */
declare const sna: {
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

export { sna };

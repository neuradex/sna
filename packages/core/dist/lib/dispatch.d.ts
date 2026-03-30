/**
 * dispatch.ts — Unified event dispatcher for SNA.
 *
 * Single entry point for all skill lifecycle events.
 * Used by both CLI (`sna dispatch`) and SDK (programmatic).
 *
 * Lifecycle:
 *   dispatch.open({ skill }) → id       (validate + create session, no event written)
 *   dispatch.send(id, { type, message }) (write event to DB)
 *   dispatch.close(id)                   (complete + kill session)
 *   dispatch.close(id, { error })        (error + kill session)
 *
 * Responsibilities:
 *   - Validate skill name against .sna/skills.json (fallback: SKILL.md existence)
 *   - Write events to SQLite (skill_events table)
 *   - On close: notify SNA API server to kill background session
 */
interface DispatchOpenOptions {
    skill: string;
    sessionId?: string;
    cwd?: string;
}
interface DispatchOpenResult {
    id: string;
    skill: string;
    sessionId: string | null;
}
type DispatchEventType = "called" | "start" | "progress" | "milestone" | "permission_needed";
interface DispatchSendOptions {
    type: DispatchEventType;
    message: string;
    data?: string;
}
interface DispatchCloseOptions {
    error?: string;
    message?: string;
}
interface DispatchSession {
    id: string;
    skill: string;
    sessionId: string | null;
    cwd: string;
    closed: boolean;
}
declare const SEND_TYPES: readonly string[];
declare function loadSkillsManifest(cwd: string): Record<string, unknown> | null;
/**
 * Open a dispatch session. Validates skill name, creates session.
 * Does NOT write any event — caller decides what to send first.
 */
declare function open(opts: DispatchOpenOptions): DispatchOpenResult;
/**
 * Send an event within an open dispatch session.
 */
declare function send(id: string, opts: DispatchSendOptions): void;
/**
 * Close a dispatch session. Emits terminal events and triggers cleanup.
 */
declare function close(id: string, opts?: DispatchCloseOptions): Promise<void>;
/**
 * Get an active dispatch session (for internal inspection).
 */
declare function getSession(id: string): DispatchSession | undefined;
/**
 * Convenience: create a dispatch handle with chainable methods.
 */
declare function createHandle(opts: DispatchOpenOptions): {
    id: string;
    skill: string;
    called: (message: string) => void;
    start: (message: string) => void;
    progress: (message: string) => void;
    milestone: (message: string) => void;
    close: (closeOpts?: DispatchCloseOptions) => Promise<void>;
};

export { type DispatchCloseOptions, type DispatchEventType, type DispatchOpenOptions, type DispatchOpenResult, type DispatchSendOptions, SEND_TYPES, close, createHandle, getSession, loadSkillsManifest, open, send };

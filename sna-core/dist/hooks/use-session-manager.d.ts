interface SessionInfo {
    id: string;
    label: string;
    alive: boolean;
    cwd: string;
    eventCount: number;
    createdAt: number;
    lastActivityAt: number;
}
/**
 * useSessionManager — manage multiple agent sessions via HTTP API.
 *
 * Provides CRUD operations for sessions:
 * - createSession: POST /agent/sessions
 * - killSession: POST /agent/kill?session=<id>
 * - deleteSession: DELETE /agent/sessions/<id>
 * - refresh: GET /agent/sessions
 */
declare function useSessionManager(): {
    sessions: SessionInfo[];
    loading: boolean;
    createSession: (opts?: {
        label?: string;
        cwd?: string;
    }) => Promise<string | null>;
    killSession: (id: string) => Promise<void>;
    deleteSession: (id: string) => Promise<void>;
    refresh: () => Promise<void>;
};

export { type SessionInfo, useSessionManager };

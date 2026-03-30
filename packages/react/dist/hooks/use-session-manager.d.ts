import { SessionInfo } from '@sna-sdk/core';
export { SessionInfo } from '@sna-sdk/core';

/**
 * useSessionManager — manage multiple agent sessions via HTTP API.
 *
 * Provides CRUD operations for sessions:
 * - createSession: POST /agent/sessions
 * - killSession: POST /agent/kill?session=<id>
 * - deleteSession: DELETE /agent/sessions/<id>
 * - refresh: GET /agent/sessions
 *
 * @param pollInterval - Auto-refresh interval in ms. 0 = no polling. Default 3000.
 */
declare function useSessionManager(pollInterval?: number): {
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

export { useSessionManager };

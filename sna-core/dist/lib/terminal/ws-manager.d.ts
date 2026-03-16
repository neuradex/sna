/**
 * Singleton WebSocket manager for the PTY terminal.
 *
 * Survives React HMR remounts — the WebSocket connection (and therefore the
 * server-side PTY / Claude Code process) stays alive even when the Terminal
 * component is unmounted and remounted by hot-module replacement.
 *
 * The module-level `instance` variable persists across HMR because bundlers
 * (webpack / Turbopack) preserve module state for side-effect-free modules
 * that are re-evaluated.  We additionally stash the instance on `globalThis`
 * so it survives even full module re-evaluation.
 */
type WsManagerListener = {
    onData?: (data: string) => void;
    onOpen?: () => void;
    onClose?: () => void;
    onConnecting?: () => void;
    onRestart?: () => void;
};
declare class WsManager {
    private ws;
    private reconnectTimer;
    private disposed;
    private listeners;
    private _connected;
    private _connecting;
    private dangerouslySkipPermissions;
    get connected(): boolean;
    get connecting(): boolean;
    /**
     * Start the connection (idempotent — if already connected, does nothing).
     */
    connect(opts?: {
        dangerouslySkipPermissions?: boolean;
    }): void;
    /**
     * Send data to the PTY (keyboard input, resize, etc.).
     */
    send(data: string): void;
    /**
     * Register a listener. Returns an unsubscribe function.
     */
    subscribe(listener: WsManagerListener): () => void;
    /**
     * Restart the terminal session — kills the current PTY and spawns a new one.
     *
     * If the WS is open, sends an in-band {type:"restart"} message so the server
     * kills and respawns the PTY without closing the WebSocket (no reconnect delay).
     * Falls back to full WS reconnect if the socket is not open.
     */
    restart(): void;
    /**
     * Permanently close the connection and stop reconnecting.
     */
    dispose(): void;
    private _doConnect;
}
declare const wsManager: WsManager;

export { type WsManagerListener, wsManager };

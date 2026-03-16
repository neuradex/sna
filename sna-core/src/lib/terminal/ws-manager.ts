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

import { TERMINAL_WS_URL } from "./constants.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WsManagerListener = {
  onData?: (data: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onConnecting?: () => void;
  onRestart?: () => void;
};

// ---------------------------------------------------------------------------
// Manager class
// ---------------------------------------------------------------------------

const RECONNECT_DELAY = 3000;

class WsManager {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private listeners = new Set<WsManagerListener>();
  private _connected = false;
  private _connecting = false;
  private dangerouslySkipPermissions = false;

  get connected() { return this._connected; }
  get connecting() { return this._connecting; }

  /**
   * Start the connection (idempotent — if already connected, does nothing).
   */
  connect(opts?: { dangerouslySkipPermissions?: boolean }) {
    if (opts?.dangerouslySkipPermissions !== undefined) {
      this.dangerouslySkipPermissions = opts.dangerouslySkipPermissions;
    }

    // Already connected or connecting — skip
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.disposed = false;
    this._doConnect();
  }

  /**
   * Send data to the PTY (keyboard input, resize, etc.).
   */
  send(data: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  /**
   * Register a listener. Returns an unsubscribe function.
   */
  subscribe(listener: WsManagerListener): () => void {
    this.listeners.add(listener);

    // Notify current state immediately
    if (this._connected) listener.onOpen?.();
    else if (this._connecting) listener.onConnecting?.();

    return () => { this.listeners.delete(listener); };
  }

  /**
   * Restart the terminal session — kills the current PTY and spawns a new one.
   *
   * If the WS is open, sends an in-band {type:"restart"} message so the server
   * kills and respawns the PTY without closing the WebSocket (no reconnect delay).
   * Falls back to full WS reconnect if the socket is not open.
   */
  restart() {
    this.listeners.forEach((l) => l.onRestart?.());
    if (this._connected && this.ws?.readyState === WebSocket.OPEN) {
      // In-band restart — server kills PTY and spawns a fresh one on same WS
      this.ws.send(JSON.stringify({ type: "restart" }));
    } else {
      // WS not open — fall back to full reconnect
      if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
      if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null; }
      this._connected = false;
      this._connecting = false;
      this._doConnect();
    }
  }

  /**
   * Permanently close the connection and stop reconnecting.
   */
  dispose() {
    this.disposed = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null; }
    this._connected = false;
    this._connecting = false;
    this.listeners.forEach((l) => l.onClose?.());
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private _doConnect() {
    if (this.disposed) return;
    if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null; }

    this._connecting = true;
    this._connected = false;
    this.listeners.forEach((l) => l.onConnecting?.());

    const url = this.dangerouslySkipPermissions
      ? `${TERMINAL_WS_URL}?dangerouslySkipPermissions=1`
      : TERMINAL_WS_URL;

    const socket = new WebSocket(url);
    this.ws = socket;

    socket.onopen = () => {
      if (this.disposed) { socket.close(); return; }
      this._connected = true;
      this._connecting = false;
      this.listeners.forEach((l) => l.onOpen?.());
    };

    socket.onmessage = (e) => {
      if (!this.disposed) {
        this.listeners.forEach((l) => l.onData?.(e.data));
      }
    };

    socket.onclose = () => {
      this._connected = false;
      this.listeners.forEach((l) => l.onClose?.());
      if (!this.disposed) {
        this._connecting = true;
        this.listeners.forEach((l) => l.onConnecting?.());
        this.reconnectTimer = setTimeout(() => this._doConnect(), RECONNECT_DELAY);
      }
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton — survives HMR via globalThis
// ---------------------------------------------------------------------------

const GLOBAL_KEY = "__sna_ws_manager__";

function getWsManager(): WsManager {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new WsManager();
  }
  return g[GLOBAL_KEY];
}

export const wsManager = getWsManager();

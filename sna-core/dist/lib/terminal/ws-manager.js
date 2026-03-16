import { TERMINAL_WS_URL } from "./constants.js";
const RECONNECT_DELAY = 3e3;
class WsManager {
  constructor() {
    this.ws = null;
    this.reconnectTimer = null;
    this.disposed = false;
    this.listeners = /* @__PURE__ */ new Set();
    this._connected = false;
    this._connecting = false;
    this.dangerouslySkipPermissions = false;
  }
  get connected() {
    return this._connected;
  }
  get connecting() {
    return this._connecting;
  }
  /**
   * Start the connection (idempotent — if already connected, does nothing).
   */
  connect(opts) {
    if (opts?.dangerouslySkipPermissions !== void 0) {
      this.dangerouslySkipPermissions = opts.dangerouslySkipPermissions;
    }
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.disposed = false;
    this._doConnect();
  }
  /**
   * Send data to the PTY (keyboard input, resize, etc.).
   */
  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }
  /**
   * Register a listener. Returns an unsubscribe function.
   */
  subscribe(listener) {
    this.listeners.add(listener);
    if (this._connected) listener.onOpen?.();
    else if (this._connecting) listener.onConnecting?.();
    return () => {
      this.listeners.delete(listener);
    };
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
      this.ws.send(JSON.stringify({ type: "restart" }));
    } else {
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      if (this.ws) {
        this.ws.onclose = null;
        this.ws.close();
        this.ws = null;
      }
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
    this._connecting = false;
    this.listeners.forEach((l) => l.onClose?.());
  }
  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------
  _doConnect() {
    if (this.disposed) return;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this._connecting = true;
    this._connected = false;
    this.listeners.forEach((l) => l.onConnecting?.());
    const url = this.dangerouslySkipPermissions ? `${TERMINAL_WS_URL}?dangerouslySkipPermissions=1` : TERMINAL_WS_URL;
    const socket = new WebSocket(url);
    this.ws = socket;
    socket.onopen = () => {
      if (this.disposed) {
        socket.close();
        return;
      }
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
const GLOBAL_KEY = "__sna_ws_manager__";
function getWsManager() {
  const g = globalThis;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new WsManager();
  }
  return g[GLOBAL_KEY];
}
const wsManager = getWsManager();
export {
  wsManager
};

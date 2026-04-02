import { fork } from "child_process";
import { fileURLToPath } from "url";
import fs from "fs";
import path from "path";
function resolveStandaloneScript() {
  const selfPath = fileURLToPath(import.meta.url);
  let script = path.resolve(path.dirname(selfPath), "../server/standalone.js");
  if (script.includes(".asar") && !script.includes(".asar.unpacked")) {
    script = script.replace(/(\.asar)([/\\])/, ".asar.unpacked$2");
  }
  if (!fs.existsSync(script)) {
    throw new Error(
      `SNA standalone script not found: ${script}
Ensure "@sna-sdk/core" is listed in asarUnpack in your electron-builder config.`
    );
  }
  return script;
}
function resolveNativeBinding(override) {
  if (override) {
    if (!fs.existsSync(override)) {
      console.warn(`[sna] SNA nativeBinding override not found: ${override}`);
      return void 0;
    }
    return override;
  }
  const BINDING_REL = path.join("better-sqlite3", "build", "Release", "better_sqlite3.node");
  const resourcesPath = process.resourcesPath;
  if (resourcesPath) {
    const unpackedBase = path.join(resourcesPath, "app.asar.unpacked", "node_modules");
    const candidates = [
      path.join(unpackedBase, BINDING_REL),
      // nested under @sna-sdk/core if hoisting differs
      path.join(unpackedBase, "@sna-sdk", "core", "node_modules", BINDING_REL)
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  }
  const selfPath = fileURLToPath(import.meta.url);
  const local = path.resolve(path.dirname(selfPath), "../../node_modules", BINDING_REL);
  if (fs.existsSync(local)) return local;
  return void 0;
}
function buildNodePath() {
  const resourcesPath = process.resourcesPath;
  if (!resourcesPath) return void 0;
  const unpacked = path.join(resourcesPath, "app.asar.unpacked", "node_modules");
  if (!fs.existsSync(unpacked)) return void 0;
  const existing = process.env.NODE_PATH;
  return existing ? `${unpacked}${path.delimiter}${existing}` : unpacked;
}
async function startSnaServer(options) {
  const port = options.port ?? 3099;
  const cwd = options.cwd ?? path.dirname(options.dbPath);
  const readyTimeout = options.readyTimeout ?? 15e3;
  const { onLog } = options;
  const standaloneScript = resolveStandaloneScript();
  const nativeBinding = resolveNativeBinding(options.nativeBinding);
  const nodePath = buildNodePath();
  const env = {
    ...process.env,
    SNA_PORT: String(port),
    SNA_DB_PATH: options.dbPath,
    ...options.maxSessions != null ? { SNA_MAX_SESSIONS: String(options.maxSessions) } : {},
    ...options.permissionMode ? { SNA_PERMISSION_MODE: options.permissionMode } : {},
    ...options.model ? { SNA_MODEL: options.model } : {},
    ...nativeBinding ? { SNA_SQLITE_NATIVE_BINDING: nativeBinding } : {},
    ...nodePath ? { NODE_PATH: nodePath } : {},
    // Consumer overrides last so they can always win
    ...options.env ?? {}
  };
  const proc = fork(standaloneScript, [], {
    cwd,
    env,
    stdio: "pipe"
  });
  let stdoutBuf = "";
  let isReady = false;
  const readyListeners = [];
  proc.stdout?.on("data", (chunk) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split("\n");
    stdoutBuf = lines.pop() ?? "";
    for (const line of lines) {
      if (onLog) onLog(line);
      if (!isReady && line.includes("API server ready")) {
        isReady = true;
        readyListeners.splice(0).forEach((cb) => cb());
      }
    }
  });
  proc.stderr?.on("data", (chunk) => {
    if (onLog) {
      chunk.toString().split("\n").filter(Boolean).forEach(onLog);
    }
  });
  await new Promise((resolve, reject) => {
    if (isReady) return resolve();
    const timer = setTimeout(() => {
      reject(new Error(`SNA server did not become ready within ${readyTimeout}ms`));
    }, readyTimeout);
    readyListeners.push(() => {
      clearTimeout(timer);
      resolve();
    });
    proc.on("exit", (code) => {
      if (!isReady) {
        clearTimeout(timer);
        reject(new Error(`SNA server process exited (code=${code ?? "null"}) before becoming ready`));
      }
    });
    proc.on("error", (err) => {
      if (!isReady) {
        clearTimeout(timer);
        reject(err);
      }
    });
  });
  return {
    process: proc,
    port,
    stop() {
      proc.kill("SIGTERM");
    }
  };
}
export {
  startSnaServer
};

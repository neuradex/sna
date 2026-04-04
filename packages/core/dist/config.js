const defaults = {
  port: 3099,
  model: "claude-sonnet-4-6",
  defaultProvider: "claude-code",
  defaultPermissionMode: "default",
  maxSessions: 5,
  maxEventBuffer: 500,
  permissionTimeoutMs: 0,
  // app controls — no SDK-side timeout
  runOnceTimeoutMs: 12e4,
  pollIntervalMs: 500,
  keepaliveIntervalMs: 15e3,
  skillPollMs: 2e3,
  dbPath: "data/sna.db"
};
function fromEnv() {
  const env = {};
  if (process.env.SNA_PORT) env.port = parseInt(process.env.SNA_PORT, 10);
  if (process.env.SNA_MODEL) env.model = process.env.SNA_MODEL;
  if (process.env.SNA_PERMISSION_MODE) env.defaultPermissionMode = process.env.SNA_PERMISSION_MODE;
  if (process.env.SNA_MAX_SESSIONS) env.maxSessions = parseInt(process.env.SNA_MAX_SESSIONS, 10);
  if (process.env.SNA_DB_PATH) env.dbPath = process.env.SNA_DB_PATH;
  if (process.env.SNA_PERMISSION_TIMEOUT_MS) env.permissionTimeoutMs = parseInt(process.env.SNA_PERMISSION_TIMEOUT_MS, 10);
  return env;
}
let current = { ...defaults, ...fromEnv() };
function getConfig() {
  return current;
}
function setConfig(overrides) {
  current = { ...current, ...overrides };
}
function resetConfig() {
  current = { ...defaults, ...fromEnv() };
}
export {
  getConfig,
  resetConfig,
  setConfig
};

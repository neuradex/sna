import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getDb } from "../db/schema.js";
const activeSessions = /* @__PURE__ */ new Map();
const SEND_TYPES = [
  "called",
  "start",
  "progress",
  "milestone",
  "permission_needed"
];
function loadSkillsManifest(cwd) {
  const manifestPath = path.join(cwd, ".sna/skills.json");
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
}
function skillMdExists(cwd, skill) {
  return fs.existsSync(path.join(cwd, ".claude/skills", skill, "SKILL.md"));
}
function generateId() {
  return crypto.randomBytes(4).toString("hex");
}
function writeEvent(sessionId, skill, type, message, data) {
  const db = getDb();
  db.prepare(`
    INSERT INTO skill_events (session_id, skill, type, message, data)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, skill, type, message, data ?? null);
}
async function notifySessionClose(cwd, sessionId) {
  if (!sessionId) return;
  try {
    const port = fs.readFileSync(path.join(cwd, ".sna/sna-api.port"), "utf8").trim();
    if (!port) return;
    await fetch(`http://localhost:${port}/agent/kill?session=${encodeURIComponent(sessionId)}`, {
      method: "POST",
      signal: AbortSignal.timeout(3e3)
    });
  } catch {
  }
}
const PREFIX = {
  called: "\u2192",
  start: "\u25B6",
  progress: "\xB7",
  milestone: "\u25C6",
  permission_needed: "\u26A0",
  complete: "\u2713",
  error: "\u2717",
  success: "\u2713",
  failed: "\u2717"
};
function log(skill, type, message) {
  const p = PREFIX[type] ?? "\xB7";
  console.log(`${p} [${skill}] ${message}`);
}
function open(opts) {
  const cwd = opts.cwd ?? process.cwd();
  const manifest = loadSkillsManifest(cwd);
  if (manifest) {
    if (!(opts.skill in manifest)) {
      if (skillMdExists(cwd, opts.skill)) {
        console.warn(
          `\u26A0 Skill "${opts.skill}" has SKILL.md but is not in .sna/skills.json \u2014 run 'sna gen client'`
        );
      } else {
        const available = Object.keys(manifest).join(", ");
        throw new Error(
          `Unknown skill: "${opts.skill}". Available: ${available}.`
        );
      }
    }
  } else {
    if (!skillMdExists(cwd, opts.skill)) {
      throw new Error(
        `Unknown skill: "${opts.skill}". No .sna/skills.json and no SKILL.md found.`
      );
    }
  }
  const id = generateId();
  const sessionId = opts.sessionId ?? process.env.SNA_SESSION_ID ?? null;
  const session = {
    id,
    skill: opts.skill,
    sessionId,
    cwd,
    closed: false
  };
  activeSessions.set(id, session);
  return { id, skill: opts.skill, sessionId };
}
function send(id, opts) {
  const session = activeSessions.get(id);
  if (!session) {
    throw new Error(`Dispatch session "${id}" not found. Call dispatch.open() first.`);
  }
  if (session.closed) {
    throw new Error(`Dispatch session "${id}" is already closed.`);
  }
  if (!SEND_TYPES.includes(opts.type)) {
    throw new Error(
      `Invalid event type: "${opts.type}". Must be one of: ${SEND_TYPES.join(", ")}`
    );
  }
  writeEvent(session.sessionId, session.skill, opts.type, opts.message, opts.data);
  log(session.skill, opts.type, opts.message);
}
async function close(id, opts) {
  const session = activeSessions.get(id);
  if (!session) {
    throw new Error(`Dispatch session "${id}" not found.`);
  }
  if (session.closed) {
    throw new Error(`Dispatch session "${id}" is already closed.`);
  }
  session.closed = true;
  if (opts?.error) {
    const message = opts.error;
    writeEvent(session.sessionId, session.skill, "error", message);
    writeEvent(session.sessionId, session.skill, "failed", message);
    log(session.skill, "error", message);
  } else {
    const message = opts?.message ?? "Done";
    writeEvent(session.sessionId, session.skill, "complete", message);
    writeEvent(session.sessionId, session.skill, "success", message);
    log(session.skill, "complete", message);
  }
  await notifySessionClose(session.cwd, session.sessionId);
  activeSessions.delete(id);
}
function getSession(id) {
  return activeSessions.get(id);
}
function createHandle(opts) {
  const result = open(opts);
  return {
    id: result.id,
    skill: result.skill,
    called: (message) => send(result.id, { type: "called", message }),
    start: (message) => send(result.id, { type: "start", message }),
    progress: (message) => send(result.id, { type: "progress", message }),
    milestone: (message) => send(result.id, { type: "milestone", message }),
    close: (closeOpts) => close(result.id, closeOpts)
  };
}
export {
  SEND_TYPES,
  close,
  createHandle,
  getSession,
  loadSkillsManifest,
  open,
  send
};

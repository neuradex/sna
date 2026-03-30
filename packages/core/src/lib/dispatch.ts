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

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getDb } from "../db/schema.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface DispatchOpenOptions {
  skill: string;
  sessionId?: string;   // SNA_SESSION_ID — ties events to a chat session
  cwd?: string;         // project root (defaults to process.cwd())
}

export interface DispatchOpenResult {
  id: string;
  skill: string;
  sessionId: string | null;
}

export type DispatchEventType =
  | "called" | "start" | "progress" | "milestone" | "permission_needed";

export interface DispatchSendOptions {
  type: DispatchEventType;
  message: string;
  data?: string;        // optional JSON payload
}

export interface DispatchCloseOptions {
  error?: string;       // if set, close as error; otherwise success
  message?: string;     // custom close message
}

interface DispatchSession {
  id: string;
  skill: string;
  sessionId: string | null;
  cwd: string;
  closed: boolean;
}

// ── State ────────────────────────────────────────────────────────────────────

const activeSessions = new Map<string, DispatchSession>();

export const SEND_TYPES: readonly string[] = [
  "called", "start", "progress", "milestone", "permission_needed",
];

// ── Helpers ──────────────────────────────────────────────────────────────────

export function loadSkillsManifest(cwd: string): Record<string, unknown> | null {
  const manifestPath = path.join(cwd, ".sna/skills.json");
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

function skillMdExists(cwd: string, skill: string): boolean {
  return fs.existsSync(path.join(cwd, ".claude/skills", skill, "SKILL.md"));
}

function generateId(): string {
  return crypto.randomBytes(4).toString("hex"); // 8-char hex
}

function writeEvent(
  sessionId: string | null,
  skill: string,
  type: string,
  message: string,
  data?: string | null,
) {
  const db = getDb();
  db.prepare(`
    INSERT INTO skill_events (session_id, skill, type, message, data)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, skill, type, message, data ?? null);
}

async function notifySessionClose(cwd: string, sessionId: string | null): Promise<void> {
  if (!sessionId) return;
  try {
    const port = fs.readFileSync(path.join(cwd, ".sna/sna-api.port"), "utf8").trim();
    if (!port) return;
    await fetch(`http://localhost:${port}/agent/kill?session=${encodeURIComponent(sessionId)}`, {
      method: "POST",
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Port file missing or server not running — fine
  }
}

// ── Console output ───────────────────────────────────────────────────────────

const PREFIX: Record<string, string> = {
  called: "→", start: "▶", progress: "·", milestone: "◆",
  permission_needed: "⚠", complete: "✓", error: "✗",
  success: "✓", failed: "✗",
};

function log(skill: string, type: string, message: string) {
  const p = PREFIX[type] ?? "·";
  console.log(`${p} [${skill}] ${message}`);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Open a dispatch session. Validates skill name, creates session.
 * Does NOT write any event — caller decides what to send first.
 */
export function open(opts: DispatchOpenOptions): DispatchOpenResult {
  const cwd = opts.cwd ?? process.cwd();

  // Validate skill: check manifest first, fall back to SKILL.md existence
  const manifest = loadSkillsManifest(cwd);
  if (manifest) {
    if (!(opts.skill in manifest)) {
      // Not in manifest — check if SKILL.md exists (might just need `sna gen client`)
      if (skillMdExists(cwd, opts.skill)) {
        console.warn(
          `⚠ Skill "${opts.skill}" has SKILL.md but is not in .sna/skills.json — run 'sna gen client'`
        );
      } else {
        const available = Object.keys(manifest).join(", ");
        throw new Error(
          `Unknown skill: "${opts.skill}". Available: ${available}.`
        );
      }
    }
  } else {
    // No manifest — fall back to SKILL.md check
    if (!skillMdExists(cwd, opts.skill)) {
      throw new Error(
        `Unknown skill: "${opts.skill}". No .sna/skills.json and no SKILL.md found.`
      );
    }
  }

  const id = generateId();
  const sessionId = opts.sessionId ?? process.env.SNA_SESSION_ID ?? null;

  const session: DispatchSession = {
    id,
    skill: opts.skill,
    sessionId,
    cwd,
    closed: false,
  };
  activeSessions.set(id, session);

  return { id, skill: opts.skill, sessionId };
}

/**
 * Send an event within an open dispatch session.
 */
export function send(id: string, opts: DispatchSendOptions): void {
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

/**
 * Close a dispatch session. Emits terminal events and triggers cleanup.
 */
export async function close(id: string, opts?: DispatchCloseOptions): Promise<void> {
  const session = activeSessions.get(id);
  if (!session) {
    throw new Error(`Dispatch session "${id}" not found.`);
  }
  if (session.closed) {
    throw new Error(`Dispatch session "${id}" is already closed.`);
  }

  session.closed = true;

  // Emit both legacy alias and canonical type for backward compat
  // (useSkillEvents listens for "success"/"failed", SSE routes use "complete"/"error")
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

  // Notify server to kill background session
  await notifySessionClose(session.cwd, session.sessionId);

  activeSessions.delete(id);
}

/**
 * Get an active dispatch session (for internal inspection).
 */
export function getSession(id: string): DispatchSession | undefined {
  return activeSessions.get(id);
}

/**
 * Convenience: create a dispatch handle with chainable methods.
 */
export function createHandle(opts: DispatchOpenOptions) {
  const result = open(opts);
  return {
    id: result.id,
    skill: result.skill,
    called: (message: string) => send(result.id, { type: "called", message }),
    start: (message: string) => send(result.id, { type: "start", message }),
    progress: (message: string) => send(result.id, { type: "progress", message }),
    milestone: (message: string) => send(result.id, { type: "milestone", message }),
    close: (closeOpts?: DispatchCloseOptions) => close(result.id, closeOpts),
  };
}

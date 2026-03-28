"use client";

import { useState, useCallback, useEffect } from "react";
import { useSnaContext } from "../core/sna-context.js";

export interface SessionInfo {
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
export function useSessionManager() {
  const { apiUrl } = useSnaContext();
  const baseUrl = `${apiUrl}/agent`;

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${baseUrl}/sessions`);
      const data = await res.json();
      setSessions(data.sessions ?? []);
    } catch {
      // Server not ready
    }
  }, [baseUrl]);

  const createSession = useCallback(async (opts?: { label?: string; cwd?: string }): Promise<string | null> => {
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts ?? {}),
      });
      const data = await res.json();
      if (data.status === "created") {
        await refresh();
        return data.sessionId;
      }
      console.error("[useSessionManager:create]", data.message);
      return null;
    } catch (err) {
      console.error("[useSessionManager:create]", err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [baseUrl, refresh]);

  const killSession = useCallback(async (id: string) => {
    try {
      await fetch(`${baseUrl}/kill?session=${encodeURIComponent(id)}`, { method: "POST" });
      await refresh();
    } catch (err) {
      console.error("[useSessionManager:kill]", err);
    }
  }, [baseUrl, refresh]);

  const deleteSession = useCallback(async (id: string) => {
    try {
      await fetch(`${baseUrl}/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      await refresh();
    } catch (err) {
      console.error("[useSessionManager:delete]", err);
    }
  }, [baseUrl, refresh]);

  // Initial fetch
  useEffect(() => {
    refresh();
  }, [refresh]);

  return { sessions, loading, createSession, killSession, deleteSession, refresh };
}

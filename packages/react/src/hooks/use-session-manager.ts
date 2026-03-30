"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { SessionInfo } from "@sna-sdk/core";
import { useSnaContext } from "../context.js";

export type { SessionInfo };

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
export function useSessionManager(pollInterval = 3000) {
  const { apiUrl } = useSnaContext();
  const baseUrl = `${apiUrl}/agent`;

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const prevJsonRef = useRef("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${baseUrl}/sessions`);
      const data = await res.json();
      const next = data.sessions ?? [];
      const json = JSON.stringify(next);
      if (json !== prevJsonRef.current) {
        prevJsonRef.current = json;
        setSessions(next);
      }
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

  // Initial fetch + polling
  useEffect(() => {
    refresh();
    if (!pollInterval) return;
    const id = setInterval(refresh, pollInterval);
    return () => clearInterval(id);
  }, [refresh, pollInterval]);

  return { sessions, loading, createSession, killSession, deleteSession, refresh };
}

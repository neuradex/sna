"use client";
import { useState, useCallback, useEffect } from "react";
import { useSnaContext } from "../context.js";
function useSessionManager() {
  const { apiUrl } = useSnaContext();
  const baseUrl = `${apiUrl}/agent`;
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${baseUrl}/sessions`);
      const data = await res.json();
      setSessions(data.sessions ?? []);
    } catch {
    }
  }, [baseUrl]);
  const createSession = useCallback(async (opts) => {
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts ?? {})
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
  const killSession = useCallback(async (id) => {
    try {
      await fetch(`${baseUrl}/kill?session=${encodeURIComponent(id)}`, { method: "POST" });
      await refresh();
    } catch (err) {
      console.error("[useSessionManager:kill]", err);
    }
  }, [baseUrl, refresh]);
  const deleteSession = useCallback(async (id) => {
    try {
      await fetch(`${baseUrl}/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      await refresh();
    } catch (err) {
      console.error("[useSessionManager:delete]", err);
    }
  }, [baseUrl, refresh]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { sessions, loading, createSession, killSession, deleteSession, refresh };
}
export {
  useSessionManager
};

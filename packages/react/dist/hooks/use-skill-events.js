"use client";
import { useEffect, useRef, useState } from "react";
import { useSnaContext } from "../context.js";
function useSkillEvents(options = {}) {
  const { enabled = true, skills, maxEvents = 100, onEvent, onInvoked, onCalled, onSuccess, onFailed, onNeedPermission, onProgress, onMilestone } = options;
  const { apiUrl } = useSnaContext();
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const lastIdRef = useRef(0);
  const esRef = useRef(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onInvokedRef = useRef(onInvoked);
  onInvokedRef.current = onInvoked;
  const onCalledRef = useRef(onCalled);
  onCalledRef.current = onCalled;
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const onFailedRef = useRef(onFailed);
  onFailedRef.current = onFailed;
  const onNeedPermissionRef = useRef(onNeedPermission);
  onNeedPermissionRef.current = onNeedPermission;
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const onMilestoneRef = useRef(onMilestone);
  onMilestoneRef.current = onMilestone;
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    function connect() {
      if (disposed) return;
      if (esRef.current) esRef.current.close();
      const url = `${apiUrl}/events?since=${lastIdRef.current}`;
      const es = new EventSource(url);
      esRef.current = es;
      es.onopen = () => setConnected(true);
      es.onmessage = (e) => {
        if (disposed) return;
        try {
          const event = JSON.parse(e.data);
          lastIdRef.current = event.id;
          if (skills && !skills.includes(event.skill)) return;
          setEvents((prev) => {
            const next = [...prev, event];
            return next.length > maxEvents ? next.slice(-maxEvents) : next;
          });
          onEventRef.current?.(event);
          if (event.type === "invoked") onInvokedRef.current?.(event);
          if (event.type === "called") onCalledRef.current?.(event);
          if (event.type === "success") onSuccessRef.current?.(event);
          if (event.type === "failed") onFailedRef.current?.(event);
          if (event.type === "permission_needed") onNeedPermissionRef.current?.(event);
          if (event.type === "progress") onProgressRef.current?.(event);
          if (event.type === "milestone") onMilestoneRef.current?.(event);
        } catch {
        }
      };
      es.onerror = () => {
        setConnected(false);
        es.close();
        if (!disposed) setTimeout(connect, 3e3);
      };
    }
    connect();
    return () => {
      disposed = true;
      esRef.current?.close();
      setConnected(false);
    };
  }, [apiUrl, enabled]);
  const latestBySkill = events.reduce((acc, e) => {
    acc[e.skill] = e;
    return acc;
  }, {});
  const TERMINAL_TYPES = /* @__PURE__ */ new Set(["success", "failed", "complete", "error"]);
  const isRunning = (skill) => {
    const latest = latestBySkill[skill];
    return !!latest && !TERMINAL_TYPES.has(latest.type);
  };
  const isWaitingForPermission = (skill) => latestBySkill[skill]?.type === "permission_needed";
  const clearEvents = () => setEvents([]);
  return { events, connected, latestBySkill, isRunning, isWaitingForPermission, clearEvents };
}
export {
  useSkillEvents
};

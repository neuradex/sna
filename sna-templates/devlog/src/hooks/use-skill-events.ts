"use client";

import { useEffect, useRef, useState } from "react";

export interface SkillEvent {
  id: number;
  skill: string;
  type: "invoked" | "called" | "success" | "failed" | "permission_needed"
      | "start" | "progress" | "milestone" | "complete" | "error";
  message: string;
  data: string | null;
  created_at: string;
}

export type SkillEventHandler = (event: SkillEvent) => void;

interface UseSkillEventsOptions {
  /** Only receive events from specific skills. Omit to receive all. */
  skills?: string[];
  /** Max events to keep in memory. Default: 100 */
  maxEvents?: number;
  /** Called for every new event */
  onEvent?: SkillEventHandler;
  /** Lifecycle: skill button pressed (frontend, instant) */
  onInvoked?: SkillEventHandler;
  /** Lifecycle: Claude started executing the skill */
  onCalled?: SkillEventHandler;
  /** Lifecycle: skill completed successfully */
  onSuccess?: SkillEventHandler;
  /** Lifecycle: skill failed */
  onFailed?: SkillEventHandler;
  /** Lifecycle: Claude is waiting for user permission */
  onNeedPermission?: SkillEventHandler;
  /** Incremental progress update from inside a skill */
  onProgress?: SkillEventHandler;
  /** Significant checkpoint emitted by a skill */
  onMilestone?: SkillEventHandler;
}

/**
 * useSkillEvents — subscribe to real-time skill events from the SNA backend.
 *
 * Skills emit events via: tsx src/scripts/emit.ts --skill <name> --type <type> --message <text>
 * Those events flow through SQLite → /api/events SSE → this hook → your UI.
 *
 * @example
 * const { events, latestBySkill } = useSkillEvents({ skills: ["devlog-collect"] });
 */
export function useSkillEvents(options: UseSkillEventsOptions = {}) {
  const { skills, maxEvents = 100, onEvent, onInvoked, onCalled, onSuccess, onFailed, onNeedPermission, onProgress, onMilestone } = options;
  const [events, setEvents] = useState<SkillEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const lastIdRef = useRef<number>(0);
  const esRef = useRef<EventSource | null>(null);
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
    let disposed = false;

    function connect() {
      if (disposed) return;
      if (esRef.current) esRef.current.close();

      const url = `/api/events?since=${lastIdRef.current}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => setConnected(true);

      es.onmessage = (e) => {
        if (disposed) return;
        try {
          const event: SkillEvent = JSON.parse(e.data);
          lastIdRef.current = event.id;

          // Filter by skill if specified
          if (skills && !skills.includes(event.skill)) return;

          setEvents((prev) => {
            const next = [...prev, event];
            return next.length > maxEvents ? next.slice(-maxEvents) : next;
          });

          onEventRef.current?.(event);

          // Lifecycle callbacks
          if (event.type === "invoked")           onInvokedRef.current?.(event);
          if (event.type === "called")            onCalledRef.current?.(event);
          if (event.type === "success")           onSuccessRef.current?.(event);
          if (event.type === "failed")            onFailedRef.current?.(event);
          if (event.type === "permission_needed") onNeedPermissionRef.current?.(event);
          if (event.type === "progress")          onProgressRef.current?.(event);
          if (event.type === "milestone")         onMilestoneRef.current?.(event);
        } catch {
          // ignore malformed events
        }
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        if (!disposed) setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      disposed = true;
      esRef.current?.close();
      setConnected(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Latest event per skill name */
  const latestBySkill = events.reduce<Record<string, SkillEvent>>((acc, e) => {
    acc[e.skill] = e;
    return acc;
  }, {});

  const TERMINAL_TYPES = new Set(["success", "failed", "complete", "error"]);
  // invoked = button pressed (frontend), called = Claude started the skill

  /** Whether a specific skill is currently running (not yet in a terminal state) */
  const isRunning = (skill: string) => {
    const latest = latestBySkill[skill];
    return !!latest && !TERMINAL_TYPES.has(latest.type);
  };

  /** Whether Claude is waiting for user permission inside a skill */
  const isWaitingForPermission = (skill: string) =>
    latestBySkill[skill]?.type === "permission_needed";

  const clearEvents = () => setEvents([]);

  return { events, connected, latestBySkill, isRunning, isWaitingForPermission, clearEvents };
}

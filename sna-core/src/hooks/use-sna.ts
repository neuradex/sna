"use client";

import { useSkillEvents, type SkillEvent, type SkillEventHandler } from "./use-skill-events.js";
import { useTerminalStore } from "../stores/terminal-store.js";

interface UseSnaOptions {
  skills?: string[];
  maxEvents?: number;
  onEvent?: SkillEventHandler;
  onCalled?: SkillEventHandler;
  onSuccess?: SkillEventHandler;
  onFailed?: SkillEventHandler;
  onPermissionNeeded?: SkillEventHandler;
  onProgress?: SkillEventHandler;
  onMilestone?: SkillEventHandler;
}

/**
 * useSna — the single entry point for SNA frontend primitives.
 *
 * Bundles:
 * 1. Skill Event Stream — real-time events from SQLite → SSE → UI
 * 2. Claude Event Hooks — lifecycle callbacks (onCalled, onSuccess, onPermissionNeeded...)
 * 3. Terminal primitive — control the embedded Claude Code terminal
 *
 * @example
 * const { events, isRunning, terminal, runSkill } = useSna({
 *   skills: ["devlog-collect"],
 *   onMilestone: (e) => console.log(e.message),
 * });
 * <button onClick={() => runSkill("devlog-collect")}>Collect</button>
 */
export function useSna(options: UseSnaOptions = {}) {
  const {
    skills, maxEvents, onEvent,
    onCalled, onSuccess, onFailed, onPermissionNeeded, onProgress, onMilestone,
  } = options;

  const {
    events, connected: eventsConnected, latestBySkill,
    isRunning, isWaitingForPermission, clearEvents,
  } = useSkillEvents({
    skills, maxEvents, onEvent,
    onCalled, onSuccess, onFailed,
    onNeedPermission: onPermissionNeeded,
    onProgress, onMilestone,
  });

  const terminalIsOpen = useTerminalStore((s) => s.isOpen);
  const terminalConnected = useTerminalStore((s) => s.connected);
  const terminalIsConnecting = useTerminalStore((s) => s.isConnecting);
  const toggleTerminal = useTerminalStore((s) => s.toggle);
  const openTerminal = useTerminalStore((s) => s.setOpen);
  const sendToTerminal = useTerminalStore((s) => s.sendToTerminal);

  const runSkill = (name: string) => {
    openTerminal(true);
    setTimeout(() => sendToTerminal(`/${name}\n`), 100);
  };

  return {
    events,
    connected: eventsConnected,
    latestBySkill,
    isRunning,
    isWaitingForPermission,
    clearEvents,
    terminal: {
      isOpen: terminalIsOpen,
      /** WebSocket is open and Claude PTY is running */
      connected: terminalConnected,
      /** WebSocket is currently connecting or reconnecting */
      isConnecting: terminalIsConnecting,
      toggle: toggleTerminal,
      setOpen: openTerminal,
      send: sendToTerminal,
    },
    runSkill,
  };
}

export type { SkillEvent, SkillEventHandler };

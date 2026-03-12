"use client";

import { useSkillEvents, type SkillEvent, type SkillEventHandler } from "./use-skill-events";
import { useTerminalStore } from "@/stores/terminal-store";

interface UseSnaOptions {
  /** Only receive events from specific skills. Omit to receive all. */
  skills?: string[];
  /** Max events to keep in memory. Default: 100 */
  maxEvents?: number;
  /** Called for every new event */
  onEvent?: SkillEventHandler;
  // --- Claude Event Hooks ---
  /** Claude started executing the skill */
  onCalled?: SkillEventHandler;
  /** Skill completed successfully */
  onSuccess?: SkillEventHandler;
  /** Skill failed */
  onFailed?: SkillEventHandler;
  /** Claude is blocked waiting for user permission */
  onPermissionNeeded?: SkillEventHandler;
  /** Incremental progress update from inside a skill */
  onProgress?: SkillEventHandler;
  /** Significant checkpoint emitted by a skill */
  onMilestone?: SkillEventHandler;
}

/**
 * useSna — the single entry point for SNA frontend primitives.
 *
 * Bundles three layers:
 *
 * 1. **Skill Event Stream** — real-time events emitted by skills via:
 *    `tsx src/scripts/emit.ts --skill <name> --type <type> --message <text>`
 *    flowing through SQLite → /api/events SSE → this hook → your UI.
 *
 * 2. **Claude Event Hooks** — lifecycle callbacks that fire at key moments:
 *    onCalled (Claude started), onSuccess/onFailed (terminal state),
 *    onPermissionNeeded (Claude is blocked), onMilestone (progress checkpoint).
 *
 * 3. **Terminal primitive** — control the embedded Claude Code terminal:
 *    open/close, check connection status, send text (e.g. run a skill).
 *
 * @example
 * const { events, isRunning, terminal, runSkill } = useSna({
 *   skills: ["devlog-collect"],
 *   onMilestone: (e) => console.log(e.message),
 *   onPermissionNeeded: (e) => showBanner("Claude needs your approval"),
 * });
 *
 * // Run a skill programmatically:
 * <button onClick={() => runSkill("devlog-collect")}>Collect</button>
 */
export function useSna(options: UseSnaOptions = {}) {
  const {
    skills,
    maxEvents,
    onEvent,
    onCalled,
    onSuccess,
    onFailed,
    onPermissionNeeded,
    onProgress,
    onMilestone,
  } = options;

  // --- Layer 1 + 2: Skill Event Stream & Claude Event Hooks ---
  const {
    events,
    connected: eventsConnected,
    latestBySkill,
    isRunning,
    isWaitingForPermission,
    clearEvents,
  } = useSkillEvents({
    skills,
    maxEvents,
    onEvent,
    onCalled,
    onSuccess,
    onFailed,
    onNeedPermission: onPermissionNeeded,
    onProgress,
    onMilestone,
  });

  // --- Layer 3: Terminal primitive ---
  const terminalIsOpen = useTerminalStore((s) => s.isOpen);
  const terminalConnected = useTerminalStore((s) => s.connected);
  const toggleTerminal = useTerminalStore((s) => s.toggle);
  const openTerminal = useTerminalStore((s) => s.setOpen);
  const sendToTerminal = useTerminalStore((s) => s.sendToTerminal);

  /**
   * Run a skill by name. Opens the terminal panel and sends the slash command.
   * Claude Code picks it up and executes the skill.
   */
  const runSkill = (name: string) => {
    openTerminal(true);
    // Small delay to allow terminal to mount if it was closed
    setTimeout(() => sendToTerminal(`/${name}\n`), 100);
  };

  return {
    // --- Skill Event Stream ---
    /** All received events (filtered by `skills` option if provided) */
    events,
    /** Whether the SSE connection to /api/events is active */
    connected: eventsConnected,
    /** Latest event per skill name */
    latestBySkill,
    /** Whether a specific skill is currently running */
    isRunning,
    /** Whether Claude is blocked waiting for user permission inside a skill */
    isWaitingForPermission,
    /** Clear the in-memory event buffer */
    clearEvents,

    // --- Terminal primitive ---
    terminal: {
      /** Whether the right-panel terminal is visible */
      isOpen: terminalIsOpen,
      /** Whether the WebSocket connection to the PTY server is active */
      connected: terminalConnected,
      /** Toggle the terminal panel open/closed */
      toggle: toggleTerminal,
      /** Open or close the terminal panel */
      setOpen: openTerminal,
      /** Send raw text to the Claude Code terminal */
      send: sendToTerminal,
    },

    // --- Convenience ---
    /** Open the terminal and run a skill by name (e.g. "devlog-collect") */
    runSkill,
  };
}

export type { SkillEvent, SkillEventHandler };

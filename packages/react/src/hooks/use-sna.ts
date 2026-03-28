"use client";

import { useCallback, useRef } from "react";
import { useSkillEvents, type SkillEvent, type SkillEventHandler } from "./use-skill-events.js";
import { useAgent, type AgentEvent } from "./use-agent.js";
import { useChatStore, type ChatMessage } from "../stores/chat-store.js";
import { useSnaContext } from "../context.js";

interface UseSnaOptions {
  /** Session ID. Defaults to "default". */
  sessionId?: string;
  skills?: string[];
  maxEvents?: number;
  /** Agent provider name. Defaults to "claude-code" */
  provider?: string;
  /** Permission mode for background sessions. Defaults to "acceptEdits" */
  permissionMode?: string;

  onEvent?: SkillEventHandler;
  onCalled?: SkillEventHandler;
  onSuccess?: SkillEventHandler;
  onFailed?: SkillEventHandler;
  onPermissionNeeded?: SkillEventHandler;
  onProgress?: SkillEventHandler;
  onMilestone?: SkillEventHandler;

  /** Called when agent streams text */
  onTextDelta?: (e: AgentEvent) => void;
  /** Called when agent completes */
  onComplete?: (e: AgentEvent) => void;
}

/**
 * useSna — the single entry point for SNA frontend primitives.
 *
 * Bundles:
 * 1. Skill Event Stream — real-time events from SQLite → SSE → UI
 * 2. Agent Session — stdio spawn of Claude Code / Codex via HTTP API
 * 3. Chat Panel — control the right-side chat panel
 *
 * @example
 * const { events, isRunning, chat, runSkill } = useSna({
 *   skills: ["devlog-collect"],
 *   provider: "claude-code",
 *   onMilestone: (e) => console.log(e.message),
 *   onTextDelta: (e) => appendChat(e.message),
 * });
 * <button onClick={() => runSkill("devlog-collect")}>Collect</button>
 */
export function useSna(options: UseSnaOptions = {}) {
  const {
    sessionId = "default",
    skills, maxEvents, onEvent,
    onCalled, onSuccess, onFailed, onPermissionNeeded, onProgress, onMilestone,
    provider = "claude-code",
    permissionMode = "acceptEdits",
    onTextDelta, onComplete,
  } = options;

  const { apiUrl } = useSnaContext();
  const bgSessionsRef = useRef<Map<string, EventSource>>(new Map());

  // 1. Skill events from SQLite → SSE
  const {
    events, connected: eventsConnected, latestBySkill,
    isRunning, isWaitingForPermission, clearEvents,
  } = useSkillEvents({
    skills, maxEvents, onEvent,
    onCalled, onSuccess, onFailed,
    onNeedPermission: onPermissionNeeded,
    onProgress, onMilestone,
  });

  // 2. Agent session (stdio spawn) — session-scoped
  const agent = useAgent({
    sessionId,
    provider,
    onAssistant: onTextDelta,
    onComplete,
  });

  // 3. Chat panel state — session-scoped
  const chatIsOpen = useChatStore((s) => s.isOpen);
  const chatMessages = useChatStore((s) => s.sessions[sessionId]?.messages ?? []);
  const toggleChat = useChatStore((s) => s.toggle);
  const openChat = useChatStore((s) => s.setOpen);
  const addChatMessage = useChatStore((s) => s.addMessage);
  const clearChatMessages = useChatStore((s) => s.clearMessages);

  /** Run a skill — opens chat, sends prompt to agent */
  const runSkill = async (name: string) => {
    openChat(true);
    addChatMessage({ role: "user", content: `/${name}` }, sessionId);
    // If agent is alive, send as a message; otherwise start a new session
    if (agent.alive) {
      await agent.send(`Execute the skill: ${name}`);
    } else {
      await agent.start(`Execute the skill: ${name}`);
    }
  };

  /** Run skill as subagent (kept for compat — same as runSkill for now) */
  const runSkillSub = runSkill;

  /**
   * Run a skill in a background session.
   * Creates a new agent session, executes the skill there,
   * and reports progress as a skill card in the main chat.
   * The main session stays free for chat.
   */
  const runSkillInBackground = useCallback(async (name: string) => {
    const baseUrl = `${apiUrl}/agent`;
    const addMessage = useChatStore.getState().addMessage;

    // 1. Create a new session
    let bgSessionId: string;
    try {
      const res = await fetch(`${baseUrl}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: `skill:${name}` }),
      });
      const data = await res.json();
      bgSessionId = data.sessionId;
    } catch (err) {
      addMessage({ role: "error", content: `Failed to create background session: ${err}` }, sessionId);
      return;
    }

    // 2. Add a running skill card to main chat
    addMessage({
      role: "skill",
      content: "",
      skillName: name,
      meta: { status: "running", milestones: [], bgSessionId },
    }, sessionId);

    // 3. Start the agent in the background session
    try {
      await fetch(`${baseUrl}/start?session=${encodeURIComponent(bgSessionId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, prompt: `Execute the skill: ${name}`, permissionMode }),
      });
    } catch (err) {
      addMessage({ role: "error", content: `Failed to start background agent: ${err}` }, sessionId);
      return;
    }

    // 4. Subscribe to background session events via SSE
    const es = new EventSource(`${baseUrl}/events?session=${encodeURIComponent(bgSessionId)}&since=0`);
    bgSessionsRef.current.set(bgSessionId, es);

    const milestones: string[] = [];

    es.onmessage = (e) => {
      if (!e.data) return;
      try {
        const event: AgentEvent = JSON.parse(e.data);

        if (event.type === "assistant" && event.message) {
          milestones.push(event.message.slice(0, 200));
          addMessage({
            role: "skill",
            content: event.message,
            skillName: name,
            meta: { status: "running", milestones: [...milestones], bgSessionId },
          }, sessionId);
        }

        if (event.type === "complete") {
          addMessage({
            role: "skill",
            content: milestones[milestones.length - 1] ?? "Done",
            skillName: name,
            meta: { status: "complete", milestones: [...milestones], bgSessionId },
          }, sessionId);
          es.close();
          bgSessionsRef.current.delete(bgSessionId);
          // Cleanup: delete the background session
          fetch(`${baseUrl}/sessions/${encodeURIComponent(bgSessionId)}`, { method: "DELETE" }).catch(() => {});
        }

        if (event.type === "error") {
          addMessage({
            role: "skill",
            content: event.message ?? "Background skill failed",
            skillName: name,
            meta: { status: "failed", milestones: [...milestones], bgSessionId },
          }, sessionId);
          es.close();
          bgSessionsRef.current.delete(bgSessionId);
          fetch(`${baseUrl}/sessions/${encodeURIComponent(bgSessionId)}`, { method: "DELETE" }).catch(() => {});
        }
      } catch { /* malformed */ }
    };

    es.onerror = () => {
      // Don't reconnect — if SSE fails, the session is likely done or dead
      es.close();
      bgSessionsRef.current.delete(bgSessionId);
    };
  }, [apiUrl, sessionId, provider, permissionMode]);

  return {
    events,
    connected: eventsConnected && agent.connected,
    latestBySkill,
    isRunning,
    isWaitingForPermission,
    clearEvents,
    agent,
    chat: {
      isOpen: chatIsOpen,
      messages: chatMessages,
      toggle: toggleChat,
      setOpen: openChat,
      addMessage: (msg: Omit<ChatMessage, "id" | "timestamp">) => addChatMessage(msg, sessionId),
      clearMessages: () => clearChatMessages(sessionId),
    },
    runSkill,
    runSkillSub,
    runSkillInBackground,
  };
}

export type { SkillEvent, SkillEventHandler, ChatMessage, AgentEvent };

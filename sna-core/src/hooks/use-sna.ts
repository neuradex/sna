"use client";

import { useSkillEvents, type SkillEvent, type SkillEventHandler } from "./use-skill-events.js";
import { useAgent, type AgentEvent } from "./use-agent.js";
import { useChatStore, type ChatMessage } from "../stores/chat-store.js";

interface UseSnaOptions {
  skills?: string[];
  maxEvents?: number;
  /** Agent provider name. Defaults to "claude-code" */
  provider?: string;

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
    skills, maxEvents, onEvent,
    onCalled, onSuccess, onFailed, onPermissionNeeded, onProgress, onMilestone,
    provider = "claude-code",
    onTextDelta, onComplete,
  } = options;

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

  // 2. Agent session (stdio spawn)
  const agent = useAgent({
    provider,
    onAssistant: onTextDelta,
    onComplete,
  });

  // 3. Chat panel state
  const chatIsOpen = useChatStore((s) => s.isOpen);
  const chatMessages = useChatStore((s) => s.messages);
  const toggleChat = useChatStore((s) => s.toggle);
  const openChat = useChatStore((s) => s.setOpen);
  const addChatMessage = useChatStore((s) => s.addMessage);
  const clearChatMessages = useChatStore((s) => s.clearMessages);

  /** Run a skill — opens chat, sends prompt to agent */
  const runSkill = async (name: string) => {
    openChat(true);
    addChatMessage({ role: "user", content: `/${name}` });
    // If agent is alive, send as a message; otherwise start a new session
    if (agent.alive) {
      await agent.send(`Execute the skill: ${name}`);
    } else {
      await agent.start(`Execute the skill: ${name}`);
    }
  };

  /** Run skill as subagent (kept for compat — same as runSkill for now) */
  const runSkillSub = async (name: string) => {
    openChat(true);
    addChatMessage({ role: "user", content: `/${name}` });
    if (agent.alive) {
      await agent.send(`Execute the skill: ${name}`);
    } else {
      await agent.start(`Execute the skill: ${name}`);
    }
  };

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
      addMessage: addChatMessage,
      clearMessages: clearChatMessages,
    },
    runSkill,
    runSkillSub,
  };
}

export type { SkillEvent, SkillEventHandler, ChatMessage, AgentEvent };

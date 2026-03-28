"use client";
import { useSkillEvents } from "./use-skill-events.js";
import { useAgent } from "./use-agent.js";
import { useChatStore } from "../stores/chat-store.js";
function useSna(options = {}) {
  const {
    sessionId = "default",
    skills,
    maxEvents,
    onEvent,
    onCalled,
    onSuccess,
    onFailed,
    onPermissionNeeded,
    onProgress,
    onMilestone,
    provider = "claude-code",
    onTextDelta,
    onComplete
  } = options;
  const {
    events,
    connected: eventsConnected,
    latestBySkill,
    isRunning,
    isWaitingForPermission,
    clearEvents
  } = useSkillEvents({
    skills,
    maxEvents,
    onEvent,
    onCalled,
    onSuccess,
    onFailed,
    onNeedPermission: onPermissionNeeded,
    onProgress,
    onMilestone
  });
  const agent = useAgent({
    sessionId,
    provider,
    onAssistant: onTextDelta,
    onComplete
  });
  const chatIsOpen = useChatStore((s) => s.isOpen);
  const chatMessages = useChatStore((s) => s.sessions[sessionId]?.messages ?? []);
  const toggleChat = useChatStore((s) => s.toggle);
  const openChat = useChatStore((s) => s.setOpen);
  const addChatMessage = useChatStore((s) => s.addMessage);
  const clearChatMessages = useChatStore((s) => s.clearMessages);
  const runSkill = async (name) => {
    openChat(true);
    addChatMessage({ role: "user", content: `/${name}` }, sessionId);
    if (agent.alive) {
      await agent.send(`Execute the skill: ${name}`);
    } else {
      await agent.start(`Execute the skill: ${name}`);
    }
  };
  const runSkillSub = async (name) => {
    openChat(true);
    addChatMessage({ role: "user", content: `/${name}` }, sessionId);
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
      addMessage: (msg) => addChatMessage(msg, sessionId),
      clearMessages: () => clearChatMessages(sessionId)
    },
    runSkill,
    runSkillSub
  };
}
export {
  useSna
};

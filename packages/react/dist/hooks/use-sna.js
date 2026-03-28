"use client";
import { useCallback, useRef } from "react";
import { useSkillEvents } from "./use-skill-events.js";
import { useAgent } from "./use-agent.js";
import { useChatStore } from "../stores/chat-store.js";
import { useSnaContext } from "../context.js";
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
    permissionMode = "acceptEdits",
    onTextDelta,
    onComplete
  } = options;
  const { apiUrl } = useSnaContext();
  const bgSessionsRef = useRef(/* @__PURE__ */ new Map());
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
  const runSkillSub = runSkill;
  const runSkillInBackground = useCallback(async (name) => {
    const baseUrl = `${apiUrl}/agent`;
    const addMessage = useChatStore.getState().addMessage;
    let bgSessionId;
    try {
      const res = await fetch(`${baseUrl}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: `skill:${name}` })
      });
      const data = await res.json();
      bgSessionId = data.sessionId;
    } catch (err) {
      addMessage({ role: "error", content: `Failed to create background session: ${err}` }, sessionId);
      return;
    }
    addMessage({
      role: "skill",
      content: "",
      skillName: name,
      meta: { status: "running", milestones: [], bgSessionId }
    }, sessionId);
    try {
      await fetch(`${baseUrl}/start?session=${encodeURIComponent(bgSessionId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, prompt: `Execute the skill: ${name}`, permissionMode })
      });
    } catch (err) {
      addMessage({ role: "error", content: `Failed to start background agent: ${err}` }, sessionId);
      return;
    }
    const es = new EventSource(`${baseUrl}/events?session=${encodeURIComponent(bgSessionId)}&since=0`);
    bgSessionsRef.current.set(bgSessionId, es);
    const milestones = [];
    es.onmessage = (e) => {
      if (!e.data) return;
      try {
        const event = JSON.parse(e.data);
        if (event.type === "assistant" && event.message) {
          milestones.push(event.message.slice(0, 200));
          addMessage({
            role: "skill",
            content: event.message,
            skillName: name,
            meta: { status: "running", milestones: [...milestones], bgSessionId }
          }, sessionId);
        }
        if (event.type === "complete") {
          addMessage({
            role: "skill",
            content: milestones[milestones.length - 1] ?? "Done",
            skillName: name,
            meta: { status: "complete", milestones: [...milestones], bgSessionId }
          }, sessionId);
          es.close();
          bgSessionsRef.current.delete(bgSessionId);
          fetch(`${baseUrl}/sessions/${encodeURIComponent(bgSessionId)}`, { method: "DELETE" }).catch(() => {
          });
        }
        if (event.type === "error") {
          addMessage({
            role: "skill",
            content: event.message ?? "Background skill failed",
            skillName: name,
            meta: { status: "failed", milestones: [...milestones], bgSessionId }
          }, sessionId);
          es.close();
          bgSessionsRef.current.delete(bgSessionId);
          fetch(`${baseUrl}/sessions/${encodeURIComponent(bgSessionId)}`, { method: "DELETE" }).catch(() => {
          });
        }
      } catch {
      }
    };
    es.onerror = () => {
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
      addMessage: (msg) => addChatMessage(msg, sessionId),
      clearMessages: () => clearChatMessages(sessionId)
    },
    runSkill,
    runSkillSub,
    runSkillInBackground
  };
}
export {
  useSna
};

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
  const runSkillInBackground = useCallback((name) => {
    const baseUrl = `${apiUrl}/agent`;
    const store = useChatStore.getState();
    return new Promise(async (resolve, reject) => {
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
        const msg = `Failed to create background session: ${err}`;
        store.addMessage({ role: "error", content: msg }, sessionId);
        reject({ status: "error", message: msg, sessionId: "" });
        return;
      }
      store.initSession(bgSessionId);
      store.addMessage({
        role: "skill",
        content: `/${name}`,
        skillName: name,
        meta: { status: "running", milestones: [], bgSessionId, label: `skill:${name}` }
      }, bgSessionId);
      try {
        await fetch(`${baseUrl}/start?session=${encodeURIComponent(bgSessionId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, prompt: `Execute the skill: ${name}`, permissionMode })
        });
      } catch (err) {
        const msg = `Failed to start background agent: ${err}`;
        store.addMessage({ role: "error", content: msg }, bgSessionId);
        reject({ status: "error", message: msg, sessionId: bgSessionId });
        return;
      }
      const es = new EventSource(`${baseUrl}/events?session=${encodeURIComponent(bgSessionId)}&since=0`);
      bgSessionsRef.current.set(bgSessionId, es);
      es.onmessage = (e) => {
        if (!e.data) return;
        try {
          const event = JSON.parse(e.data);
          const addMsg = useChatStore.getState().addMessage;
          if (event.type === "thinking" && event.message) {
            addMsg({ role: "thinking", content: event.message, meta: { done: true } }, bgSessionId);
          }
          if (event.type === "assistant" && event.message) {
            addMsg({ role: "assistant", content: event.message, meta: { animate: true } }, bgSessionId);
          }
          if (event.type === "tool_use") {
            const toolName = event.data?.toolName ?? event.message ?? "tool";
            addMsg({ role: "tool", content: toolName, meta: { toolName, input: event.data?.input } }, bgSessionId);
          }
          if (event.type === "complete") {
            addMsg({
              role: "skill",
              content: "Done",
              skillName: name,
              meta: { status: "complete", bgSessionId }
            }, bgSessionId);
            es.close();
            bgSessionsRef.current.delete(bgSessionId);
            resolve({ status: "complete", message: event.message ?? "Done", sessionId: bgSessionId });
          }
          if (event.type === "error") {
            const msg = event.message ?? "Background skill failed";
            addMsg({ role: "error", content: msg, skillName: name }, bgSessionId);
            es.close();
            bgSessionsRef.current.delete(bgSessionId);
            reject({ status: "error", message: msg, sessionId: bgSessionId });
          }
        } catch {
        }
      };
      es.onerror = () => {
        es.close();
        bgSessionsRef.current.delete(bgSessionId);
        reject({ status: "error", message: "SSE connection lost", sessionId: bgSessionId });
      };
    });
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

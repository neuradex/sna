"use client";
import { useSkillEvents } from "./use-skill-events.js";
import { useTerminalStore } from "../stores/terminal-store.js";
function useSna(options = {}) {
  const {
    skills,
    maxEvents,
    onEvent,
    onCalled,
    onSuccess,
    onFailed,
    onPermissionNeeded,
    onProgress,
    onMilestone
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
  const terminalIsOpen = useTerminalStore((s) => s.isOpen);
  const terminalConnected = useTerminalStore((s) => s.connected);
  const terminalIsConnecting = useTerminalStore((s) => s.isConnecting);
  const toggleTerminal = useTerminalStore((s) => s.toggle);
  const openTerminal = useTerminalStore((s) => s.setOpen);
  const sendToTerminal = useTerminalStore((s) => s.sendToTerminal);
  const runSkill = (name) => {
    openTerminal(true);
    setTimeout(() => sendToTerminal(`/${name}
`), 100);
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
      send: sendToTerminal
    },
    runSkill
  };
}
export {
  useSna
};

import { SkillEventHandler } from './use-skill-events.js';
import { AgentEvent, SkillEvent } from '@sna-sdk/core';
export { AgentEvent, SkillEvent } from '@sna-sdk/core';
import { ChatMessage } from '../stores/chat-store.js';
import 'zustand';

interface UseSnaOptions {
    /** Session ID. Defaults to "default". */
    sessionId?: string;
    skills?: string[];
    maxEvents?: number;
    /** Agent provider name. Defaults to "claude-code" */
    provider?: string;
    /** Permission mode for the agent. If omitted, uses Claude Code's default (interactive approval). */
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
interface SkillResult {
    status: "complete" | "error";
    message: string;
    sessionId: string;
}
declare function useSna(options?: UseSnaOptions): {
    events: SkillEvent[];
    connected: boolean;
    latestBySkill: Record<string, SkillEvent>;
    isRunning: (skill: string) => boolean;
    isWaitingForPermission: (skill: string) => boolean;
    clearEvents: () => void;
    agent: {
        connected: boolean;
        alive: boolean;
        start: (prompt?: string) => Promise<any>;
        send: (message: string) => Promise<any>;
        kill: () => Promise<void>;
    };
    chat: {
        isOpen: boolean;
        messages: ChatMessage[];
        toggle: () => void;
        setOpen: (open: boolean) => void;
        addMessage: (msg: Omit<ChatMessage, "id" | "timestamp">) => void;
        clearMessages: () => void;
    };
    runSkill: (name: string) => Promise<void>;
    runSkillSub: (name: string) => Promise<void>;
    runSkillInBackground: (name: string) => Promise<SkillResult>;
};

export { ChatMessage, SkillEventHandler, type SkillResult, useSna };

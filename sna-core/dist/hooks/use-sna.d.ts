import { SkillEventHandler, SkillEvent } from './use-skill-events.js';

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
declare function useSna(options?: UseSnaOptions): {
    events: SkillEvent[];
    connected: boolean;
    latestBySkill: Record<string, SkillEvent>;
    isRunning: (skill: string) => boolean;
    isWaitingForPermission: (skill: string) => boolean;
    clearEvents: () => void;
    terminal: {
        isOpen: boolean;
        /** WebSocket is open and Claude PTY is running */
        connected: boolean;
        /** WebSocket is currently connecting or reconnecting */
        isConnecting: boolean;
        toggle: () => void;
        setOpen: (open: boolean) => void;
        send: (text: string) => void;
        sendSub: (text: string) => void;
    };
    runSkill: (name: string) => void;
    runSkillSub: (name: string) => void;
};

export { SkillEvent, SkillEventHandler, useSna };

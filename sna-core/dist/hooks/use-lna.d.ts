import { SkillEventHandler, SkillEvent } from './use-skill-events.js';

interface UseLnaOptions {
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
 * useLna — the single entry point for SNA frontend primitives.
 *
 * Bundles:
 * 1. Skill Event Stream — real-time events from SQLite → SSE → UI
 * 2. Claude Event Hooks — lifecycle callbacks (onCalled, onSuccess, onPermissionNeeded...)
 * 3. Terminal primitive — control the embedded Claude Code terminal
 *
 * @example
 * const { events, isRunning, terminal, runSkill } = useLna({
 *   skills: ["devlog-collect"],
 *   onMilestone: (e) => console.log(e.message),
 * });
 * <button onClick={() => runSkill("devlog-collect")}>Collect</button>
 */
declare function useLna(options?: UseLnaOptions): {
    events: SkillEvent[];
    connected: boolean;
    latestBySkill: Record<string, SkillEvent>;
    isRunning: (skill: string) => boolean;
    isWaitingForPermission: (skill: string) => boolean;
    clearEvents: () => void;
    terminal: {
        isOpen: boolean;
        connected: boolean;
        toggle: () => void;
        setOpen: (open: boolean) => void;
        send: (text: string) => void;
    };
    runSkill: (name: string) => void;
};

export { SkillEvent, SkillEventHandler, useLna };

interface SkillEvent {
    id: number;
    skill: string;
    type: "invoked" | "called" | "success" | "failed" | "permission_needed" | "start" | "progress" | "milestone" | "complete" | "error";
    message: string;
    data: string | null;
    created_at: string;
}
type SkillEventHandler = (event: SkillEvent) => void;
interface UseSkillEventsOptions {
    skills?: string[];
    maxEvents?: number;
    onEvent?: SkillEventHandler;
    onInvoked?: SkillEventHandler;
    onCalled?: SkillEventHandler;
    onSuccess?: SkillEventHandler;
    onFailed?: SkillEventHandler;
    onNeedPermission?: SkillEventHandler;
    onProgress?: SkillEventHandler;
    onMilestone?: SkillEventHandler;
}
/**
 * useSkillEvents — subscribe to real-time skill events from the SNA backend.
 *
 * Skills emit events via: tsx node_modules/lna/src/scripts/emit.ts --skill <name> --type <type> --message <text>
 * Those events flow through SQLite → /api/events SSE → this hook → your UI.
 */
declare function useSkillEvents(options?: UseSkillEventsOptions): {
    events: SkillEvent[];
    connected: boolean;
    latestBySkill: Record<string, SkillEvent>;
    isRunning: (skill: string) => boolean;
    isWaitingForPermission: (skill: string) => boolean;
    clearEvents: () => void;
};

export { type SkillEvent, type SkillEventHandler, useSkillEvents };

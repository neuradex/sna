import { SkillResult } from './use-sna.js';
import * as _sna_sdk_core from '@sna-sdk/core';
import { AgentEvent } from '@sna-sdk/core';
import { SkillEventHandler } from './use-skill-events.js';
import { ChatMessage } from '../stores/chat-store.js';
import 'zustand';

interface UseSnaClientOptions {
    sessionId?: string;
    skills?: string[];
    maxEvents?: number;
    provider?: string;
    permissionMode?: string;
    onEvent?: SkillEventHandler;
    onTextDelta?: (e: AgentEvent) => void;
    onComplete?: (e: AgentEvent) => void;
}
/**
 * useSnaClient — wraps useSna and binds a generated skill client.
 *
 * @example
 * import { bindSkills } from "./sna-client";  // auto-generated
 *
 * function MyComponent() {
 *   const { skills, ...sna } = useSnaClient({ bindSkills });
 *   await skills.formFill({ sessionId: 123 });
 * }
 */
declare function useSnaClient<T>(options?: UseSnaClientOptions & {
    bindSkills?: (runner: (command: string) => Promise<SkillResult>) => T;
}): {
    skills: T;
    events: _sna_sdk_core.SkillEvent[];
    connected: boolean;
    latestBySkill: Record<string, _sna_sdk_core.SkillEvent>;
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

export { SkillResult, useSnaClient };

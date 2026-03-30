import Database from 'better-sqlite3';

declare function getDb(): Database.Database;
interface ChatSession {
    id: string;
    label: string;
    type: "main" | "background";
    meta: string | null;
    created_at: string;
}
interface ChatMessage {
    id: number;
    session_id: string;
    role: string;
    content: string;
    skill_name: string | null;
    meta: string | null;
    created_at: string;
}
interface SkillEvent {
    id: number;
    session_id: string | null;
    skill: string;
    type: "invoked" | "called" | "success" | "failed" | "permission_needed" | "start" | "progress" | "milestone" | "complete" | "error";
    message: string;
    data: string | null;
    created_at: string;
}

export { type ChatMessage, type ChatSession, type SkillEvent, getDb };

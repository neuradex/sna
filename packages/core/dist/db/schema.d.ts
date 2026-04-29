import Database from 'better-sqlite3';

declare function getDb(): Database.Database;
interface ChatSession {
    id: string;
    label: string;
    type: "main" | "background";
    meta: string | null;
    cwd: string | null;
    created_at: string;
}
/** Block actor — who produced the content. */
type ChatActor = "user" | "assistant" | "system";
/** Block kind — what kind of content. Valid (actor, kind) pairs enforced at write time. */
type ChatKind = "text" | "thinking" | "tool_use" | "tool_result" | "status" | "error";
interface ChatMessage {
    id: number;
    session_id: string;
    actor: ChatActor;
    kind: ChatKind;
    content: string;
    /** JSON: { "<embedId>": { mime_type: string; path: string; ... } }. Null if no attachments. */
    embeds: string | null;
    meta: string | null;
    created_at: string;
    updated_at: string;
}

export { type ChatActor, type ChatKind, type ChatMessage, type ChatSession, getDb };

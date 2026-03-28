import Database from 'better-sqlite3';

declare function getDb(): Database.Database;
interface SkillEvent {
    id: number;
    skill: string;
    type: "invoked" | "called" | "success" | "failed" | "permission_needed" | "start" | "progress" | "milestone" | "complete" | "error";
    message: string;
    data: string | null;
    created_at: string;
}

export { type SkillEvent, getDb };

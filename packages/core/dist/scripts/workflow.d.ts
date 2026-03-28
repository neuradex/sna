/**
 * workflow.ts — SNA Workflow Engine
 *
 * Enforces step ordering, data validation, and event emission for skills.
 * Low-intelligence models (Haiku) can't skip steps or forget events.
 *
 * Step types:
 *   exec        — CLI auto-executes a command, extracts fields from response
 *   instruction — displays task to the model, receives structured data via stdin
 *
 * Instruction steps with `submit` + `handler`:
 *   1. Model submits JSON to stdin  (sna <id> next <<'EOF' ... EOF)
 *   2. CLI validates against submit schema
 *   3. CLI executes handler (e.g. curl to app API) with submitted data
 *   4. CLI extracts fields from API response → context
 *   5. CLI emits event with interpolated message
 *
 * CLI:
 *   sna new <skill> [--param val ...]        → create task, auto-run exec steps
 *   sna <task-id> start                      → (re)start task
 *   sna <task-id> next [--key val | < json]  → submit data for current step
 */
interface WorkflowParam {
    type: "string" | "integer" | "number" | "boolean";
    required?: boolean;
}
interface StepDataField {
    key: string;
    when: "before" | "after";
    type: "string" | "integer" | "number" | "boolean" | "json";
    label?: string;
}
interface SubmitItemField {
    type: "string" | "integer" | "number" | "boolean";
    required?: boolean;
}
interface SubmitDef {
    type: "array" | "object";
    items?: Record<string, SubmitItemField>;
}
interface WorkflowStep {
    id: string;
    name: string;
    exec?: string;
    instruction?: string;
    extract?: Record<string, string>;
    data?: StepDataField[];
    submit?: SubmitDef;
    handler?: string;
    event?: string;
    timeout?: number;
}
interface WorkflowDef {
    version: number;
    skill: string;
    params?: Record<string, WorkflowParam>;
    steps: WorkflowStep[];
    complete: string;
    error: string;
}
interface StepStatus {
    status: "pending" | "in_progress" | "completed" | "error";
}
interface TaskState {
    task_id: string;
    skill: string;
    status: "created" | "in_progress" | "completed" | "error" | "cancelled";
    started_at: string;
    params: Record<string, unknown>;
    context: Record<string, unknown>;
    current_step: number;
    steps: Record<string, StepStatus>;
}
declare function ensureTasksDir(): void;
declare function generateTaskId(): string;
declare function loadWorkflow(skillName: string): WorkflowDef;
declare function loadTask(taskId: string): TaskState;
declare function saveTask(task: TaskState): void;
declare function interpolate(template: string, context: Record<string, unknown>): string;
declare function kebabToSnake(s: string): string;
declare function parseCliFlags(args: string[]): Record<string, string>;
declare function coerceValue(raw: string, type: string): unknown;
declare function readStdin(): string;
declare function validateSubmitData(step: WorkflowStep, raw: string): unknown;
/**
 * Resolve a dot-path (e.g. "a.b[0].c") against a data structure.
 * Supports: field access (.a), nested (.a.b.c), array index (.[0], .a[0]).
 */
declare function resolvePath(data: unknown, pathStr: string): unknown;
declare function applyExtract(data: unknown, expr: string): unknown;
declare function cmdNew(args: string[]): void;
declare function cmdWorkflow(taskId: string, args: string[]): void;
declare function cmdCancel(taskId: string): void;
declare function cmdTasks(): void;
declare const _test: {
    resolvePath: typeof resolvePath;
    applyExtract: typeof applyExtract;
    interpolate: typeof interpolate;
    coerceValue: typeof coerceValue;
    kebabToSnake: typeof kebabToSnake;
    parseCliFlags: typeof parseCliFlags;
    validateSubmitData: typeof validateSubmitData;
    readStdin: typeof readStdin;
    loadWorkflow: typeof loadWorkflow;
    loadTask: typeof loadTask;
    saveTask: typeof saveTask;
    generateTaskId: typeof generateTaskId;
    ensureTasksDir: typeof ensureTasksDir;
    TASKS_DIR: string;
};

export { _test, cmdCancel, cmdNew, cmdTasks, cmdWorkflow };

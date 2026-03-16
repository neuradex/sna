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
declare function cmdNew(args: string[]): void;
declare function cmdWorkflow(taskId: string, args: string[]): void;

export { cmdNew, cmdWorkflow };

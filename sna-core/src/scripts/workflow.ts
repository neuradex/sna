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

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { getDb } from "../db/schema.js";

// ── Types ────────────────────────────────────────────────────────────────────

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
  timeout?: number; // ms, default 30000
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

// ── Helpers ──────────────────────────────────────────────────────────────────

const ROOT = process.cwd();
const TASKS_DIR = path.join(ROOT, ".sna", "tasks");

function ensureTasksDir() {
  if (!fs.existsSync(TASKS_DIR)) fs.mkdirSync(TASKS_DIR, { recursive: true });
}

function generateTaskId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const base =
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds());

  ensureTasksDir();

  if (!fs.existsSync(path.join(TASKS_DIR, `${base}.json`))) return base;

  for (let i = 0; i < 26; i++) {
    const candidate = base + String.fromCharCode(97 + i);
    if (!fs.existsSync(path.join(TASKS_DIR, `${candidate}.json`))) return candidate;
  }
  return base + Date.now().toString(36).slice(-3);
}

function loadWorkflow(skillName: string): WorkflowDef {
  const candidates = [
    path.join(ROOT, `.claude/skills/${skillName}/workflow.yml`),
    path.join(ROOT, `.claude/skills/${skillName}/workflow.yaml`),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, "utf8");
      return yaml.load(raw) as WorkflowDef;
    }
  }
  throw new Error(`No workflow.yml found for skill "${skillName}"`);
}

function loadTask(taskId: string): TaskState {
  const p = path.join(TASKS_DIR, `${taskId}.json`);
  if (!fs.existsSync(p)) throw new Error(`Task ${taskId} not found`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function saveTask(task: TaskState) {
  ensureTasksDir();
  fs.writeFileSync(
    path.join(TASKS_DIR, `${task.task_id}.json`),
    JSON.stringify(task, null, 2) + "\n"
  );
}

function interpolate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const val = context[key];
    if (val === undefined || val === null) return `{{${key}}}`;
    if (typeof val === "object") return JSON.stringify(val);
    return String(val);
  });
}

function emitEvent(skill: string, type: string, message: string) {
  const db = getDb();
  db.prepare(`
    INSERT INTO skill_events (skill, type, message)
    VALUES (?, ?, ?)
  `).run(skill, type, message);

  const prefix: Record<string, string> = {
    start: "▶",
    progress: "·",
    milestone: "◆",
    complete: "✓",
    error: "✗",
  };
  const p = prefix[type] ?? "·";
  console.log(`${p} [${skill}] ${message}`);
}

function kebabToSnake(s: string): string {
  return s.replace(/-/g, "_");
}

function parseCliFlags(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg?.startsWith("--")) {
      const key = kebabToSnake(arg.slice(2));
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        result[key] = next;
        i++;
      } else {
        result[key] = "true";
      }
    }
  }
  return result;
}

function coerceValue(raw: string, type: string): unknown {
  switch (type) {
    case "integer": {
      const n = parseInt(raw, 10);
      if (isNaN(n) || String(n) !== raw) return undefined;
      return n;
    }
    case "number": {
      const n = parseFloat(raw);
      if (isNaN(n)) return undefined;
      return n;
    }
    case "boolean":
      if (raw === "true") return true;
      if (raw === "false") return false;
      return undefined;
    case "json":
      try { return JSON.parse(raw); }
      catch { return undefined; }
    case "string":
    default:
      return raw;
  }
}

// ── Validation ───────────────────────────────────────────────────────────────

function validateParams(
  def: WorkflowDef,
  provided: Record<string, string>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const errors: string[] = [];

  if (!def.params) return provided;

  for (const [key, spec] of Object.entries(def.params)) {
    const raw = provided[key];
    if (raw === undefined) {
      if (spec.required) errors.push(`--${key.replace(/_/g, "-")} is required`);
      continue;
    }
    const val = coerceValue(raw, spec.type);
    if (val === undefined) {
      errors.push(`--${key.replace(/_/g, "-")}: ${spec.type} が必要です (got "${raw}")`);
    } else {
      result[key] = val;
    }
  }

  if (errors.length > 0) {
    console.error(`✗ Parameter errors:`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }

  return { ...provided, ...result };
}

function validateSubmission(
  step: WorkflowStep,
  data: Record<string, string>,
  taskId: string
): Record<string, unknown> {
  const afterFields = (step.data ?? []).filter((f) => f.when === "after");
  if (afterFields.length === 0) return {};

  const result: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const field of afterFields) {
    const raw = data[field.key];
    if (raw === undefined) {
      errors.push(`--${field.key.replace(/_/g, "-")} is required`);
      continue;
    }
    const val = coerceValue(raw, field.type);
    if (val === undefined) {
      errors.push(`--${field.key.replace(/_/g, "-")}: ${field.type} が必要です (got "${raw}")`);
    } else {
      result[field.key] = val;
    }
  }

  if (errors.length > 0) {
    console.error(`✗ Validation errors:`);
    for (const e of errors) console.error(`  ${e}`);
    console.error("");
    printRequiredSubmission(afterFields, taskId);
    process.exit(1);
  }

  return result;
}

function printRequiredSubmission(fields: StepDataField[], taskId: string) {
  const parts = fields.map((f) => {
    const flag = `--${f.key.replace(/_/g, "-")}`;
    const placeholder = f.type === "integer" || f.type === "number" ? "N" : `<${f.type}>`;
    const label = f.label ? ` (${f.label})` : "";
    return `    ${flag} ${placeholder}${label}`;
  });
  console.log(`Required:`);
  console.log(`  sna ${taskId} next \\`);
  console.log(parts.join(" \\\n"));
}

// ── stdin JSON ───────────────────────────────────────────────────────────────

function readStdin(): string {
  try {
    return fs.readFileSync(0, "utf8").trim();
  } catch {
    return "";
  }
}

function validateSubmitData(step: WorkflowStep, raw: string): unknown {
  const submit = step.submit!;

  if (!raw) {
    console.error(`✗ stdin が空です。JSON を提出してください。`);
    printSubmitExample(step);
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(`✗ JSON パースエラー`);
    printSubmitExample(step);
    process.exit(1);
  }

  // Type check
  if (submit.type === "array") {
    if (!Array.isArray(parsed)) {
      console.error(`✗ JSON配列が必要です (got ${typeof parsed})`);
      printSubmitExample(step);
      process.exit(1);
    }
    if (parsed.length === 0) {
      console.error(`✗ 空の配列は提出できません`);
      process.exit(1);
    }
  } else if (submit.type === "object") {
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.error(`✗ JSONオブジェクトが必要です (got ${Array.isArray(parsed) ? "array" : typeof parsed})`);
      printSubmitExample(step);
      process.exit(1);
    }
  }

  // Validate items schema if defined
  if (submit.items) {
    const items = submit.type === "array" ? (parsed as unknown[]) : [parsed];
    const errors: string[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i] as Record<string, unknown>;
      if (typeof item !== "object" || item === null) {
        errors.push(`[${i}]: オブジェクトが必要です`);
        continue;
      }
      for (const [key, spec] of Object.entries(submit.items)) {
        if (spec.required === true && (item[key] === undefined || item[key] === null || item[key] === "")) {
          errors.push(`[${i}].${key}: 必須フィールドです`);
        }
      }
    }

    if (errors.length > 0) {
      console.error(`✗ バリデーションエラー:`);
      for (const e of errors.slice(0, 10)) console.error(`  ${e}`);
      if (errors.length > 10) console.error(`  ... 他 ${errors.length - 10} 件`);
      process.exit(1);
    }
  }

  return parsed;
}

function printSubmitExample(step: WorkflowStep) {
  if (!step.submit?.items) return;
  const example: Record<string, string> = {};
  for (const [key, spec] of Object.entries(step.submit.items)) {
    example[key] = spec.type === "string" ? "..." : "0";
  }
  const json = step.submit.type === "array"
    ? JSON.stringify([example], null, 2)
    : JSON.stringify(example, null, 2);
  console.error(`\nExample:`);
  console.error(`  sna <task-id> next <<'EOF'`);
  console.error(json);
  console.error(`EOF`);
}

// ── Handler execution ────────────────────────────────────────────────────────

function executeHandler(step: WorkflowStep, submitted: unknown, context: Record<string, unknown>): Record<string, unknown> {
  const handlerTemplate = step.handler!;
  const jsonStr = JSON.stringify(submitted);

  // Interpolate {{submitted}} with the raw JSON, plus any context vars
  const cmd = interpolate(handlerTemplate, { ...context, submitted: jsonStr })
    .replace(/\{\{submitted\}\}/g, jsonStr);

  let output: string;
  try {
    output = execSync(cmd, { encoding: "utf8", cwd: ROOT, timeout: step.timeout ?? 30000 }).trim();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`handler failed: ${msg}`);
  }

  // Extract fields from response
  const extracted: Record<string, unknown> = {};
  if (step.extract) {
    try {
      const parsed = JSON.parse(output);
      for (const [key, expr] of Object.entries(step.extract)) {
        extracted[key] = applyExtract(parsed, expr);
      }
    } catch {
      // Non-JSON response — store raw
      extracted._handler_response = output;
    }
  }

  return extracted;
}

// ── Exec step execution ─────────────────────────────────────────────────────

function executeExecStep(step: WorkflowStep, context: Record<string, unknown>): Record<string, unknown> {
  const cmd = interpolate(step.exec!, context);
  let output: string;
  try {
    output = execSync(cmd, { encoding: "utf8", cwd: ROOT, timeout: step.timeout ?? 30000 }).trim();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`exec step "${step.id}" failed: ${msg}`);
  }

  const extracted: Record<string, unknown> = {};
  if (step.extract) {
    for (const [key, jqExpr] of Object.entries(step.extract)) {
      try {
        const parsed = JSON.parse(output);
        extracted[key] = applyExtract(parsed, jqExpr);
      } catch {
        extracted[key] = output;
      }
    }
  }

  return extracted;
}

/**
 * Resolve a dot-path (e.g. "a.b[0].c") against a data structure.
 * Supports: field access (.a), nested (.a.b.c), array index (.[0], .a[0]).
 */
function resolvePath(data: unknown, pathStr: string): unknown {
  const segments = pathStr.match(/[^.\[\]]+|\[\d+\]/g);
  if (!segments) return data;

  let current: unknown = data;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;

    const indexMatch = seg.match(/^\[(\d+)\]$/);
    if (indexMatch) {
      if (Array.isArray(current)) {
        current = current[parseInt(indexMatch[1])];
      } else {
        return undefined;
      }
    } else {
      if (typeof current === "object" && current !== null) {
        current = (current as Record<string, unknown>)[seg];
      } else {
        return undefined;
      }
    }
  }
  return current;
}

function applyExtract(data: unknown, expr: string): unknown {
  // "[.[] | .field.nested]" → map array items through path
  const mapMatch = expr.match(/^\[\.?\[\]\s*\|\s*\.(.+)\]$/);
  if (mapMatch && Array.isArray(data)) {
    return data.map((item: unknown) => resolvePath(item, mapMatch[1]));
  }

  // "." → identity
  if (expr === ".") return data;

  // ".field", ".field.nested", ".field[0].nested" → nested path
  if (expr.startsWith(".")) {
    return resolvePath(data, expr.slice(1));
  }

  return data;
}

// ── Step display ─────────────────────────────────────────────────────────────

function displayStep(step: WorkflowStep, stepIndex: number, totalSteps: number, context: Record<string, unknown>, taskId: string) {
  console.log("");
  console.log(`Step ${stepIndex + 1}/${totalSteps}: ${step.name}`);

  if (step.instruction) {
    console.log(interpolate(step.instruction, context));
  }

  // submit (stdin JSON) の場合
  if (step.submit) {
    printSubmitExample(step);
    return;
  }

  // data (CLI flags) の場合
  const afterFields = (step.data ?? []).filter((f) => f.when === "after");
  if (afterFields.length > 0) {
    console.log("");
    console.log("Submit:");
    printRequiredSubmission(afterFields, taskId);
  }
}

// ── Auto-advance exec chain ─────────────────────────────────────────────────

function autoAdvance(task: TaskState, workflow: WorkflowDef): TaskState {
  while (task.current_step < workflow.steps.length) {
    const step = workflow.steps[task.current_step];
    if (!step.exec) break;

    const stepNum = task.current_step + 1;
    const total = workflow.steps.length;
    process.stdout.write(`⚡ Step ${stepNum}/${total} [exec]: ${step.name}...`);

    try {
      const extracted = executeExecStep(step, { ...task.params, ...task.context });
      Object.assign(task.context, extracted);
      task.steps[step.id] = { status: "completed" };

      if (step.event) {
        const msg = interpolate(step.event, task.context);
        emitEvent(workflow.skill, "milestone", msg);
      }

      console.log(" done");
    } catch (err: unknown) {
      console.log(" failed");
      const msg = err instanceof Error ? err.message : String(err);
      task.steps[step.id] = { status: "error" };
      task.status = "error";
      saveTask(task);
      emitEvent(workflow.skill, "error", interpolate(workflow.error, { ...task.context, error: msg }));
      process.exit(1);
    }

    task.current_step++;
  }

  return task;
}

// ── Commands ─────────────────────────────────────────────────────────────────

export function cmdNew(args: string[]) {
  const skillName = args[0];
  if (!skillName) {
    console.error("Usage: sna new <skill> [--param val ...]");
    process.exit(1);
  }

  const workflow = loadWorkflow(skillName);
  const flags = parseCliFlags(args.slice(1));
  const params = validateParams(workflow, flags);

  const taskId = generateTaskId();
  const task: TaskState = {
    task_id: taskId,
    skill: workflow.skill,
    status: "in_progress",
    started_at: new Date().toISOString(),
    params,
    context: { ...params },
    current_step: 0,
    steps: Object.fromEntries(workflow.steps.map((s) => [s.id, { status: "pending" }])),
  };

  saveTask(task);
  console.log(`▶ Task ${taskId} created (${workflow.skill})`);

  emitEvent(workflow.skill, "start", `Task ${taskId} started`);

  const firstStep = workflow.steps[0];
  if (firstStep) {
    task.steps[firstStep.id] = { status: "in_progress" };
  }

  const advanced = autoAdvance(task, workflow);

  if (advanced.current_step < workflow.steps.length) {
    const currentStep = workflow.steps[advanced.current_step];
    advanced.steps[currentStep.id] = { status: "in_progress" };
    saveTask(advanced);
    displayStep(currentStep, advanced.current_step, workflow.steps.length, advanced.context, taskId);
  } else {
    advanced.status = "completed";
    saveTask(advanced);
    const msg = interpolate(workflow.complete, advanced.context);
    emitEvent(workflow.skill, "complete", msg);
    console.log(`\n${msg}`);
  }
}

export function cmdWorkflow(taskId: string, args: string[]) {
  const subcommand = args[0];
  const task = loadTask(taskId);
  const workflow = loadWorkflow(task.skill);

  if (subcommand === "start") {
    if (task.status === "completed") {
      console.error(`Task ${taskId} is already completed.`);
      process.exit(1);
    }
    if (task.status === "cancelled") {
      console.error(`Task ${taskId} is cancelled. Create a new task instead.`);
      process.exit(1);
    }

    // Error recovery: reset failed step and retry
    if (task.status === "error") {
      const currentStep = workflow.steps[task.current_step];
      task.status = "in_progress";
      task.steps[currentStep.id] = { status: "in_progress" };
      saveTask(task);
      console.log(`↻ Retrying from step ${task.current_step + 1}/${workflow.steps.length}: ${currentStep.name}`);
    }

    const advanced = autoAdvance(task, workflow);

    if (advanced.current_step < workflow.steps.length) {
      const currentStep = workflow.steps[advanced.current_step];
      advanced.steps[currentStep.id] = { status: "in_progress" };
      saveTask(advanced);
      displayStep(currentStep, advanced.current_step, workflow.steps.length, advanced.context, taskId);
    } else {
      advanced.status = "completed";
      saveTask(advanced);
      const msg = interpolate(workflow.complete, advanced.context);
      emitEvent(workflow.skill, "complete", msg);
      console.log(`\n${msg}`);
    }
    return;
  }

  if (subcommand === "next") {
    if (task.status === "completed") {
      console.error(`Task ${taskId} is already completed.`);
      process.exit(1);
    }

    if (task.current_step >= workflow.steps.length) {
      console.error(`Task ${taskId} has no more steps.`);
      process.exit(1);
    }

    const currentStep = workflow.steps[task.current_step];

    // ── submit (stdin JSON) + handler パス ──
    if (currentStep.submit) {
      const raw = readStdin();
      const submitted = validateSubmitData(currentStep, raw);

      // handler があれば実行して API レスポンスを extract
      if (currentStep.handler) {
        process.stdout.write(`⚡ Handler: ${currentStep.name}...`);
        try {
          const extracted = executeHandler(currentStep, submitted, task.context);
          Object.assign(task.context, extracted);
          console.log(" done");
        } catch (err: unknown) {
          console.log(" failed");
          const msg = err instanceof Error ? err.message : String(err);
          task.steps[currentStep.id] = { status: "error" };
          task.status = "error";
          saveTask(task);
          emitEvent(workflow.skill, "error", interpolate(workflow.error, { ...task.context, error: msg }));
          process.exit(1);
        }
      } else {
        // handler なし — submitted data をそのまま context に
        task.context.submitted = submitted;
      }

      task.steps[currentStep.id] = { status: "completed" };

      if (currentStep.event) {
        const msg = interpolate(currentStep.event, task.context);
        emitEvent(workflow.skill, "milestone", msg);
      }

      task.current_step++;
      const advanced = autoAdvance(task, workflow);

      if (advanced.current_step < workflow.steps.length) {
        const nextStep = workflow.steps[advanced.current_step];
        advanced.steps[nextStep.id] = { status: "in_progress" };
        saveTask(advanced);
        displayStep(nextStep, advanced.current_step, workflow.steps.length, advanced.context, taskId);
      } else {
        advanced.status = "completed";
        saveTask(advanced);
        const msg = interpolate(workflow.complete, advanced.context);
        emitEvent(workflow.skill, "complete", msg);
        console.log(`\n${msg}`);
      }
      return;
    }

    // ── data (CLI flags) パス（従来） ──
    const flags = parseCliFlags(args.slice(1));
    const validated = validateSubmission(currentStep, flags, taskId);
    Object.assign(task.context, validated);

    task.steps[currentStep.id] = { status: "completed" };

    if (currentStep.event) {
      const msg = interpolate(currentStep.event, task.context);
      emitEvent(workflow.skill, "milestone", msg);
    }

    task.current_step++;
    const advanced = autoAdvance(task, workflow);

    if (advanced.current_step < workflow.steps.length) {
      const nextStep = workflow.steps[advanced.current_step];
      advanced.steps[nextStep.id] = { status: "in_progress" };
      saveTask(advanced);
      displayStep(nextStep, advanced.current_step, workflow.steps.length, advanced.context, taskId);
    } else {
      advanced.status = "completed";
      saveTask(advanced);
      const msg = interpolate(workflow.complete, advanced.context);
      emitEvent(workflow.skill, "complete", msg);
      console.log(`\n${msg}`);
    }
    return;
  }

  console.error(`Usage: sna ${taskId} <start|next|cancel> [--key val ...]`);
  process.exit(1);
}

export function cmdCancel(taskId: string) {
  const task = loadTask(taskId);

  if (task.status === "completed") {
    console.error(`Task ${taskId} is already completed.`);
    process.exit(1);
  }
  if (task.status === "cancelled") {
    console.error(`Task ${taskId} is already cancelled.`);
    process.exit(1);
  }

  const workflow = loadWorkflow(task.skill);
  const currentStep = workflow.steps[task.current_step];
  if (currentStep) {
    task.steps[currentStep.id] = { status: "error" };
  }
  task.status = "cancelled";
  saveTask(task);

  emitEvent(workflow.skill, "error", `Task ${taskId} cancelled`);
  console.log(`✗ Task ${taskId} cancelled`);
}

export function cmdTasks() {
  ensureTasksDir();
  const files = fs.readdirSync(TASKS_DIR).filter((f) => f.endsWith(".json")).sort();

  if (files.length === 0) {
    console.log("No tasks found.");
    return;
  }

  console.log("── Tasks ──────────────────────────────────────────────────────");
  console.log(
    "  ID           Skill                Status       Step"
  );
  console.log("  ─────────    ──────────────────    ──────────   ────────────────");

  for (const file of files) {
    const task: TaskState = JSON.parse(fs.readFileSync(path.join(TASKS_DIR, file), "utf8"));
    let workflow: WorkflowDef | null = null;
    try {
      workflow = loadWorkflow(task.skill);
    } catch { /* workflow file may have been deleted */ }

    const totalSteps = workflow ? workflow.steps.length : "?";
    const currentStepId = workflow && task.current_step < workflow.steps.length
      ? workflow.steps[task.current_step].id
      : "";

    const statusIcon: Record<string, string> = {
      in_progress: "▶",
      completed: "✓",
      error: "✗",
      cancelled: "■",
      created: "·",
    };
    const icon = statusIcon[task.status] ?? "·";
    const stepLabel = task.status === "completed"
      ? `${totalSteps}/${totalSteps}`
      : `${task.current_step + 1}/${totalSteps} ${currentStepId}`;

    console.log(
      `  ${task.task_id.padEnd(13)}${task.skill.padEnd(22)}${icon} ${task.status.padEnd(13)}${stepLabel}`
    );
  }

  console.log("───────────────────────────────────────────────────────────────");
}

// ── Exports for testing ──────────────────────────────────────────────────────

export const _test = {
  resolvePath,
  applyExtract,
  interpolate,
  coerceValue,
  kebabToSnake,
  parseCliFlags,
  validateSubmitData,
  readStdin,
  loadWorkflow,
  loadTask,
  saveTask,
  generateTaskId,
  ensureTasksDir,
  TASKS_DIR,
};

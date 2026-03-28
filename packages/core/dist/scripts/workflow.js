import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { getDb } from "../db/schema.js";
const ROOT = process.cwd();
const TASKS_DIR = path.join(ROOT, ".sna", "tasks");
function ensureTasksDir() {
  if (!fs.existsSync(TASKS_DIR)) fs.mkdirSync(TASKS_DIR, { recursive: true });
}
function generateTaskId() {
  const now = /* @__PURE__ */ new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const base = pad(now.getMonth() + 1) + pad(now.getDate()) + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
  ensureTasksDir();
  if (!fs.existsSync(path.join(TASKS_DIR, `${base}.json`))) return base;
  for (let i = 0; i < 26; i++) {
    const candidate = base + String.fromCharCode(97 + i);
    if (!fs.existsSync(path.join(TASKS_DIR, `${candidate}.json`))) return candidate;
  }
  return base + Date.now().toString(36).slice(-3);
}
function loadWorkflow(skillName) {
  const candidates = [
    path.join(ROOT, `.claude/skills/${skillName}/workflow.yml`),
    path.join(ROOT, `.claude/skills/${skillName}/workflow.yaml`)
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, "utf8");
      return yaml.load(raw);
    }
  }
  throw new Error(`No workflow.yml found for skill "${skillName}"`);
}
function loadTask(taskId) {
  const p = path.join(TASKS_DIR, `${taskId}.json`);
  if (!fs.existsSync(p)) throw new Error(`Task ${taskId} not found`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function saveTask(task) {
  ensureTasksDir();
  fs.writeFileSync(
    path.join(TASKS_DIR, `${task.task_id}.json`),
    JSON.stringify(task, null, 2) + "\n"
  );
}
function interpolate(template, context) {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    const val = context[key];
    if (val === void 0 || val === null) return `{{${key}}}`;
    if (typeof val === "object") return JSON.stringify(val);
    return String(val);
  });
}
function emitEvent(skill, type, message) {
  const db = getDb();
  db.prepare(`
    INSERT INTO skill_events (skill, type, message)
    VALUES (?, ?, ?)
  `).run(skill, type, message);
  const prefix = {
    start: "\u25B6",
    progress: "\xB7",
    milestone: "\u25C6",
    complete: "\u2713",
    error: "\u2717"
  };
  const p = prefix[type] ?? "\xB7";
  console.log(`${p} [${skill}] ${message}`);
}
function kebabToSnake(s) {
  return s.replace(/-/g, "_");
}
function parseCliFlags(args) {
  const result = {};
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
function coerceValue(raw, type) {
  switch (type) {
    case "integer": {
      const n = parseInt(raw, 10);
      if (isNaN(n) || String(n) !== raw) return void 0;
      return n;
    }
    case "number": {
      const n = parseFloat(raw);
      if (isNaN(n)) return void 0;
      return n;
    }
    case "boolean":
      if (raw === "true") return true;
      if (raw === "false") return false;
      return void 0;
    case "json":
      try {
        return JSON.parse(raw);
      } catch {
        return void 0;
      }
    case "string":
    default:
      return raw;
  }
}
function validateParams(def, provided) {
  const result = {};
  const errors = [];
  if (!def.params) return provided;
  for (const [key, spec] of Object.entries(def.params)) {
    const raw = provided[key];
    if (raw === void 0) {
      if (spec.required) errors.push(`--${key.replace(/_/g, "-")} is required`);
      continue;
    }
    const val = coerceValue(raw, spec.type);
    if (val === void 0) {
      errors.push(`--${key.replace(/_/g, "-")}: ${spec.type} \u304C\u5FC5\u8981\u3067\u3059 (got "${raw}")`);
    } else {
      result[key] = val;
    }
  }
  if (errors.length > 0) {
    console.error(`\u2717 Parameter errors:`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  return { ...provided, ...result };
}
function validateSubmission(step, data, taskId) {
  const afterFields = (step.data ?? []).filter((f) => f.when === "after");
  if (afterFields.length === 0) return {};
  const result = {};
  const errors = [];
  for (const field of afterFields) {
    const raw = data[field.key];
    if (raw === void 0) {
      errors.push(`--${field.key.replace(/_/g, "-")} is required`);
      continue;
    }
    const val = coerceValue(raw, field.type);
    if (val === void 0) {
      errors.push(`--${field.key.replace(/_/g, "-")}: ${field.type} \u304C\u5FC5\u8981\u3067\u3059 (got "${raw}")`);
    } else {
      result[field.key] = val;
    }
  }
  if (errors.length > 0) {
    console.error(`\u2717 Validation errors:`);
    for (const e of errors) console.error(`  ${e}`);
    console.error("");
    printRequiredSubmission(afterFields, taskId);
    process.exit(1);
  }
  return result;
}
function printRequiredSubmission(fields, taskId) {
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
function readStdin() {
  try {
    return fs.readFileSync(0, "utf8").trim();
  } catch {
    return "";
  }
}
function validateSubmitData(step, raw) {
  const submit = step.submit;
  if (!raw) {
    console.error(`\u2717 stdin \u304C\u7A7A\u3067\u3059\u3002JSON \u3092\u63D0\u51FA\u3057\u3066\u304F\u3060\u3055\u3044\u3002`);
    printSubmitExample(step);
    process.exit(1);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(`\u2717 JSON \u30D1\u30FC\u30B9\u30A8\u30E9\u30FC`);
    printSubmitExample(step);
    process.exit(1);
  }
  if (submit.type === "array") {
    if (!Array.isArray(parsed)) {
      console.error(`\u2717 JSON\u914D\u5217\u304C\u5FC5\u8981\u3067\u3059 (got ${typeof parsed})`);
      printSubmitExample(step);
      process.exit(1);
    }
    if (parsed.length === 0) {
      console.error(`\u2717 \u7A7A\u306E\u914D\u5217\u306F\u63D0\u51FA\u3067\u304D\u307E\u305B\u3093`);
      process.exit(1);
    }
  } else if (submit.type === "object") {
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.error(`\u2717 JSON\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u304C\u5FC5\u8981\u3067\u3059 (got ${Array.isArray(parsed) ? "array" : typeof parsed})`);
      printSubmitExample(step);
      process.exit(1);
    }
  }
  if (submit.items) {
    const items = submit.type === "array" ? parsed : [parsed];
    const errors = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (typeof item !== "object" || item === null) {
        errors.push(`[${i}]: \u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u304C\u5FC5\u8981\u3067\u3059`);
        continue;
      }
      for (const [key, spec] of Object.entries(submit.items)) {
        if (spec.required === true && (item[key] === void 0 || item[key] === null || item[key] === "")) {
          errors.push(`[${i}].${key}: \u5FC5\u9808\u30D5\u30A3\u30FC\u30EB\u30C9\u3067\u3059`);
        }
      }
    }
    if (errors.length > 0) {
      console.error(`\u2717 \u30D0\u30EA\u30C7\u30FC\u30B7\u30E7\u30F3\u30A8\u30E9\u30FC:`);
      for (const e of errors.slice(0, 10)) console.error(`  ${e}`);
      if (errors.length > 10) console.error(`  ... \u4ED6 ${errors.length - 10} \u4EF6`);
      process.exit(1);
    }
  }
  return parsed;
}
function printSubmitExample(step) {
  if (!step.submit?.items) return;
  const example = {};
  for (const [key, spec] of Object.entries(step.submit.items)) {
    example[key] = spec.type === "string" ? "..." : "0";
  }
  const json = step.submit.type === "array" ? JSON.stringify([example], null, 2) : JSON.stringify(example, null, 2);
  console.error(`
Example:`);
  console.error(`  sna <task-id> next <<'EOF'`);
  console.error(json);
  console.error(`EOF`);
}
function executeHandler(step, submitted, context) {
  const handlerTemplate = step.handler;
  const jsonStr = JSON.stringify(submitted);
  const cmd = interpolate(handlerTemplate, { ...context, submitted: jsonStr }).replace(/\{\{submitted\}\}/g, jsonStr);
  let output;
  try {
    output = execSync(cmd, { encoding: "utf8", cwd: ROOT, timeout: step.timeout ?? 3e4 }).trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`handler failed: ${msg}`);
  }
  const extracted = {};
  if (step.extract) {
    try {
      const parsed = JSON.parse(output);
      for (const [key, expr] of Object.entries(step.extract)) {
        extracted[key] = applyExtract(parsed, expr);
      }
    } catch {
      extracted._handler_response = output;
    }
  }
  return extracted;
}
function executeExecStep(step, context) {
  const cmd = interpolate(step.exec, context);
  let output;
  try {
    output = execSync(cmd, { encoding: "utf8", cwd: ROOT, timeout: step.timeout ?? 3e4 }).trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`exec step "${step.id}" failed: ${msg}`);
  }
  const extracted = {};
  if (step.extract) {
    let parsed;
    let parseOk = false;
    try {
      parsed = JSON.parse(output);
      parseOk = true;
    } catch {
    }
    for (const [key, jqExpr] of Object.entries(step.extract)) {
      extracted[key] = parseOk ? applyExtract(parsed, jqExpr) : output;
    }
  }
  return extracted;
}
function resolvePath(data, pathStr) {
  const segments = pathStr.match(/[^.\[\]]+|\[\d+\]/g);
  if (!segments) return data;
  let current = data;
  for (const seg of segments) {
    if (current === null || current === void 0) return void 0;
    const indexMatch = seg.match(/^\[(\d+)\]$/);
    if (indexMatch) {
      if (Array.isArray(current)) {
        current = current[parseInt(indexMatch[1])];
      } else {
        return void 0;
      }
    } else {
      if (typeof current === "object" && current !== null) {
        current = current[seg];
      } else {
        return void 0;
      }
    }
  }
  return current;
}
function applyExtract(data, expr) {
  const mapMatch = expr.match(/^\[\.?\[\]\s*\|\s*\.(.+)\]$/);
  if (mapMatch && Array.isArray(data)) {
    return data.map((item) => resolvePath(item, mapMatch[1]));
  }
  if (expr === ".") return data;
  if (expr.startsWith(".")) {
    return resolvePath(data, expr.slice(1));
  }
  return data;
}
function displayStep(step, stepIndex, totalSteps, context, taskId) {
  console.log("");
  console.log(`Step ${stepIndex + 1}/${totalSteps}: ${step.name}`);
  if (step.instruction) {
    console.log(interpolate(step.instruction, context));
  }
  if (step.submit) {
    printSubmitExample(step);
    return;
  }
  const afterFields = (step.data ?? []).filter((f) => f.when === "after");
  if (afterFields.length > 0) {
    console.log("");
    console.log("Submit:");
    printRequiredSubmission(afterFields, taskId);
  }
}
function autoAdvance(task, workflow) {
  while (task.current_step < workflow.steps.length) {
    const step = workflow.steps[task.current_step];
    if (!step.exec) break;
    const stepNum = task.current_step + 1;
    const total = workflow.steps.length;
    process.stdout.write(`\u26A1 Step ${stepNum}/${total} [exec]: ${step.name}...`);
    try {
      const extracted = executeExecStep(step, { ...task.params, ...task.context });
      Object.assign(task.context, extracted);
      task.steps[step.id] = { status: "completed" };
      if (step.event) {
        const msg = interpolate(step.event, task.context);
        emitEvent(workflow.skill, "milestone", msg);
      }
      console.log(" done");
    } catch (err) {
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
function cmdNew(args) {
  const skillName = args[0];
  if (!skillName) {
    console.error("Usage: sna new <skill> [--param val ...]");
    process.exit(1);
  }
  const workflow = loadWorkflow(skillName);
  const flags = parseCliFlags(args.slice(1));
  const params = validateParams(workflow, flags);
  const taskId = generateTaskId();
  const task = {
    task_id: taskId,
    skill: workflow.skill,
    status: "in_progress",
    started_at: (/* @__PURE__ */ new Date()).toISOString(),
    params,
    context: { ...params },
    current_step: 0,
    steps: Object.fromEntries(workflow.steps.map((s) => [s.id, { status: "pending" }]))
  };
  saveTask(task);
  console.log(`\u25B6 Task ${taskId} created (${workflow.skill})`);
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
    console.log(`
${msg}`);
  }
}
function cmdWorkflow(taskId, args) {
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
    if (task.status === "error") {
      const currentStep = workflow.steps[task.current_step];
      task.status = "in_progress";
      task.steps[currentStep.id] = { status: "in_progress" };
      saveTask(task);
      console.log(`\u21BB Retrying from step ${task.current_step + 1}/${workflow.steps.length}: ${currentStep.name}`);
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
      console.log(`
${msg}`);
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
    if (currentStep.submit) {
      const raw = readStdin();
      const submitted = validateSubmitData(currentStep, raw);
      if (currentStep.handler) {
        process.stdout.write(`\u26A1 Handler: ${currentStep.name}...`);
        try {
          const extracted = executeHandler(currentStep, submitted, task.context);
          Object.assign(task.context, extracted);
          console.log(" done");
        } catch (err) {
          console.log(" failed");
          const msg = err instanceof Error ? err.message : String(err);
          task.steps[currentStep.id] = { status: "error" };
          task.status = "error";
          saveTask(task);
          emitEvent(workflow.skill, "error", interpolate(workflow.error, { ...task.context, error: msg }));
          process.exit(1);
        }
      } else {
        task.context.submitted = submitted;
      }
      task.steps[currentStep.id] = { status: "completed" };
      if (currentStep.event) {
        const msg = interpolate(currentStep.event, task.context);
        emitEvent(workflow.skill, "milestone", msg);
      }
      task.current_step++;
      const advanced2 = autoAdvance(task, workflow);
      if (advanced2.current_step < workflow.steps.length) {
        const nextStep = workflow.steps[advanced2.current_step];
        advanced2.steps[nextStep.id] = { status: "in_progress" };
        saveTask(advanced2);
        displayStep(nextStep, advanced2.current_step, workflow.steps.length, advanced2.context, taskId);
      } else {
        advanced2.status = "completed";
        saveTask(advanced2);
        const msg = interpolate(workflow.complete, advanced2.context);
        emitEvent(workflow.skill, "complete", msg);
        console.log(`
${msg}`);
      }
      return;
    }
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
      console.log(`
${msg}`);
    }
    return;
  }
  console.error(`Usage: sna ${taskId} <start|next|cancel> [--key val ...]`);
  process.exit(1);
}
function cmdCancel(taskId) {
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
  console.log(`\u2717 Task ${taskId} cancelled`);
}
function cmdTasks() {
  ensureTasksDir();
  const files = fs.readdirSync(TASKS_DIR).filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) {
    console.log("No tasks found.");
    return;
  }
  console.log("\u2500\u2500 Tasks \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  console.log(
    "  ID           Skill                Status       Step"
  );
  console.log("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500    \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500    \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500   \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  for (const file of files) {
    const task = JSON.parse(fs.readFileSync(path.join(TASKS_DIR, file), "utf8"));
    let workflow = null;
    try {
      workflow = loadWorkflow(task.skill);
    } catch {
    }
    const totalSteps = workflow ? workflow.steps.length : "?";
    const currentStepId = workflow && task.current_step < workflow.steps.length ? workflow.steps[task.current_step].id : "";
    const statusIcon = {
      in_progress: "\u25B6",
      completed: "\u2713",
      error: "\u2717",
      cancelled: "\u25A0",
      created: "\xB7"
    };
    const icon = statusIcon[task.status] ?? "\xB7";
    const stepLabel = task.status === "completed" ? `${totalSteps}/${totalSteps}` : `${task.current_step + 1}/${totalSteps} ${currentStepId}`;
    console.log(
      `  ${task.task_id.padEnd(13)}${task.skill.padEnd(22)}${icon} ${task.status.padEnd(13)}${stepLabel}`
    );
  }
  console.log("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
}
const _test = {
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
  TASKS_DIR
};
export {
  _test,
  cmdCancel,
  cmdNew,
  cmdTasks,
  cmdWorkflow
};

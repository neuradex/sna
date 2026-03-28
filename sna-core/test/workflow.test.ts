/**
 * Unit tests for SNA Workflow Engine
 *
 * Run: pnpm test
 * Uses Node's built-in test runner (node:test) via tsx.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { _test } from "../src/scripts/workflow.js";

const {
  resolvePath,
  applyExtract,
  interpolate,
  coerceValue,
  kebabToSnake,
  parseCliFlags,
} = _test;

// ── resolvePath ─────────────────────────────────────────────────────────────

describe("resolvePath", () => {
  const data = {
    a: 1,
    b: { c: 2, d: { e: 3 } },
    arr: [{ name: "x" }, { name: "y" }],
    nested: { arr: [10, 20, 30] },
  };

  it("resolves a top-level field", () => {
    assert.equal(resolvePath(data, "a"), 1);
  });

  it("resolves nested fields", () => {
    assert.equal(resolvePath(data, "b.c"), 2);
    assert.equal(resolvePath(data, "b.d.e"), 3);
  });

  it("resolves array index", () => {
    assert.deepEqual(resolvePath(data, "arr[0]"), { name: "x" });
    assert.equal(resolvePath(data, "arr[1].name"), "y");
  });

  it("resolves nested array index", () => {
    assert.equal(resolvePath(data, "nested.arr[0]"), 10);
    assert.equal(resolvePath(data, "nested.arr[2]"), 30);
  });

  it("returns undefined for missing paths", () => {
    assert.equal(resolvePath(data, "missing"), undefined);
    assert.equal(resolvePath(data, "b.missing.deep"), undefined);
    assert.equal(resolvePath(data, "arr[99]"), undefined);
  });

  it("handles null/undefined data", () => {
    assert.equal(resolvePath(null, "a"), undefined);
    assert.equal(resolvePath(undefined, "a"), undefined);
  });
});

// ── applyExtract ────────────────────────────────────────────────────────────

describe("applyExtract", () => {
  it("identity (.)", () => {
    assert.deepEqual(applyExtract({ a: 1 }, "."), { a: 1 });
  });

  it("single field (.field)", () => {
    assert.equal(applyExtract({ name: "foo", age: 30 }, ".name"), "foo");
  });

  it("nested field (.a.b.c)", () => {
    assert.equal(applyExtract({ a: { b: { c: 42 } } }, ".a.b.c"), 42);
  });

  it("array index (.[0])", () => {
    assert.equal(applyExtract(["a", "b", "c"], ".[0]"), "a");
  });

  it("field then array index (.items[0].name)", () => {
    const data = { items: [{ name: "first" }, { name: "second" }] };
    assert.equal(applyExtract(data, ".items[0].name"), "first");
    assert.equal(applyExtract(data, ".items[1].name"), "second");
  });

  it("map array ([.[] | .field])", () => {
    const data = [{ name: "a" }, { name: "b" }, { name: "c" }];
    assert.deepEqual(applyExtract(data, "[.[] | .name]"), ["a", "b", "c"]);
  });

  it("map array with nested path ([.[] | .a.b])", () => {
    const data = [{ a: { b: 1 } }, { a: { b: 2 } }];
    assert.deepEqual(applyExtract(data, "[.[] | .a.b]"), [1, 2]);
  });
});

// ── interpolate ─────────────────────────────────────────────────────────────

describe("interpolate", () => {
  it("replaces {{key}} with values", () => {
    assert.equal(interpolate("Hello {{name}}", { name: "World" }), "Hello World");
  });

  it("replaces multiple keys", () => {
    assert.equal(
      interpolate("{{a}} + {{b}} = {{c}}", { a: 1, b: 2, c: 3 }),
      "1 + 2 = 3"
    );
  });

  it("preserves unreplaced keys", () => {
    assert.equal(interpolate("{{known}} {{unknown}}", { known: "yes" }), "yes {{unknown}}");
  });

  it("serializes objects to JSON", () => {
    const result = interpolate("data: {{obj}}", { obj: { a: 1 } });
    assert.equal(result, 'data: {"a":1}');
  });

  it("handles null/undefined", () => {
    assert.equal(interpolate("{{a}}", { a: null }), "{{a}}");
    assert.equal(interpolate("{{a}}", {}), "{{a}}");
  });
});

// ── coerceValue ─────────────────────────────────────────────────────────────

describe("coerceValue", () => {
  it("coerces string", () => {
    assert.equal(coerceValue("hello", "string"), "hello");
  });

  it("coerces integer", () => {
    assert.equal(coerceValue("42", "integer"), 42);
    assert.equal(coerceValue("0", "integer"), 0);
    assert.equal(coerceValue("-5", "integer"), -5);
  });

  it("rejects non-integer", () => {
    assert.equal(coerceValue("3.14", "integer"), undefined);
    assert.equal(coerceValue("abc", "integer"), undefined);
    assert.equal(coerceValue("", "integer"), undefined);
  });

  it("coerces number", () => {
    assert.equal(coerceValue("3.14", "number"), 3.14);
    assert.equal(coerceValue("42", "number"), 42);
  });

  it("rejects non-number", () => {
    assert.equal(coerceValue("abc", "number"), undefined);
  });

  it("coerces boolean", () => {
    assert.equal(coerceValue("true", "boolean"), true);
    assert.equal(coerceValue("false", "boolean"), false);
    assert.equal(coerceValue("yes", "boolean"), undefined);
  });

  it("coerces json", () => {
    assert.deepEqual(coerceValue('{"a":1}', "json"), { a: 1 });
    assert.deepEqual(coerceValue("[1,2]", "json"), [1, 2]);
    assert.equal(coerceValue("bad json", "json"), undefined);
  });
});

// ── kebabToSnake ────────────────────────────────────────────────────────────

describe("kebabToSnake", () => {
  it("converts kebab-case to snake_case", () => {
    assert.equal(kebabToSnake("registered-count"), "registered_count");
    assert.equal(kebabToSnake("a-b-c"), "a_b_c");
  });

  it("leaves non-kebab strings unchanged", () => {
    assert.equal(kebabToSnake("simple"), "simple");
    assert.equal(kebabToSnake("already_snake"), "already_snake");
  });
});

// ── parseCliFlags ───────────────────────────────────────────────────────────

describe("parseCliFlags", () => {
  it("parses --key value pairs", () => {
    assert.deepEqual(parseCliFlags(["--name", "foo", "--count", "5"]), {
      name: "foo",
      count: "5",
    });
  });

  it("converts kebab-case to snake_case", () => {
    assert.deepEqual(parseCliFlags(["--my-param", "val"]), {
      my_param: "val",
    });
  });

  it("treats flag without value as 'true'", () => {
    assert.deepEqual(parseCliFlags(["--verbose"]), {
      verbose: "true",
    });
  });

  it("treats flag followed by another flag as 'true'", () => {
    assert.deepEqual(parseCliFlags(["--a", "--b", "val"]), {
      a: "true",
      b: "val",
    });
  });

  it("ignores non-flag arguments", () => {
    assert.deepEqual(parseCliFlags(["extra", "--key", "val"]), {
      key: "val",
    });
  });

  it("returns empty for empty input", () => {
    assert.deepEqual(parseCliFlags([]), {});
  });
});

// ── Integration: task lifecycle ─────────────────────────────────────────────
// Note: workflow.ts evaluates ROOT = process.cwd() at import time.
// We set up fixtures under the actual cwd (sna-core/) and clean up after.

describe("task lifecycle (integration)", () => {
  const ROOT = process.cwd();
  const SKILL_DIR = path.join(ROOT, ".claude", "skills", "test-multi-step");
  const TASKS_DIR_PATH = path.join(ROOT, ".sna", "tasks");

  before(() => {
    fs.mkdirSync(SKILL_DIR, { recursive: true });
    fs.copyFileSync(
      path.join(import.meta.dirname, "fixtures", "workflow.yml"),
      path.join(SKILL_DIR, "workflow.yml")
    );
  });

  after(() => {
    fs.rmSync(SKILL_DIR, { recursive: true, force: true });
    try { fs.unlinkSync(path.join(TASKS_DIR_PATH, "9999999999.json")); } catch { /* ok */ }
  });

  it("loadWorkflow loads the test workflow", () => {
    const wf = _test.loadWorkflow("test-multi-step");
    assert.equal(wf.skill, "test-multi-step");
    assert.equal(wf.steps.length, 4);
    assert.equal(wf.steps[0].id, "fetch-config");
    assert.equal(wf.steps[1].id, "check-status");
    assert.equal(wf.steps[2].id, "collect-data");
    assert.equal(wf.steps[3].id, "review");
  });

  it("loadWorkflow validates step types", () => {
    const wf = _test.loadWorkflow("test-multi-step");
    // First two are exec
    assert.ok(wf.steps[0].exec);
    assert.ok(wf.steps[1].exec);
    // Last two are instruction
    assert.ok(wf.steps[2].instruction);
    assert.ok(wf.steps[3].instruction);
    // Step 3 has submit + handler
    assert.ok(wf.steps[2].submit);
    assert.ok(wf.steps[2].handler);
    // Step 4 has data
    assert.ok(wf.steps[3].data);
    assert.equal(wf.steps[3].data!.length, 2);
  });

  it("loadWorkflow respects timeout field", () => {
    const wf = _test.loadWorkflow("test-multi-step");
    assert.equal(wf.steps[2].timeout, 60000);
    assert.equal(wf.steps[0].timeout, undefined);
  });

  it("generateTaskId produces 10-digit IDs", () => {
    const id = _test.generateTaskId();
    assert.match(id, /^\d{10}[a-z]?$/);
  });

  it("saveTask + loadTask roundtrip", () => {
    const task = {
      task_id: "9999999999",
      skill: "test-multi-step",
      status: "in_progress" as const,
      started_at: "2026-03-17T00:00:00Z",
      params: { target: "test" },
      context: { target: "test" },
      current_step: 0,
      steps: { "fetch-config": { status: "pending" as const } },
    };
    _test.saveTask(task);
    const loaded = _test.loadTask("9999999999");
    assert.deepEqual(loaded, task);
  });

  it("extract patterns work with workflow-defined expressions", () => {
    const wf = _test.loadWorkflow("test-multi-step");
    // Step 1 extract: ".server.host" (nested path)
    const data = { server: { host: "localhost", port: 3000 }, items: [{ name: "a" }] };
    assert.equal(applyExtract(data, wf.steps[0].extract!.server_host), "localhost");
    assert.equal(applyExtract(data, wf.steps[0].extract!.server_port), 3000);
    assert.equal(applyExtract(data, wf.steps[0].extract!.first_item), "a");
  });
});

/**
 * Unit tests for the listModels surface added to AgentProviders.
 *
 * Covers:
 *   - parseOpenCodeModelsOutput pure parser
 *   - ClaudeCodeProvider.listModels static branch (no baseUrl)
 *   - CodexProvider.listModels static catalog
 *   - HTTP-shape parity check via api-types.ts (typed at compile time, but
 *     we sanity-check the runtime response shape here too)
 *
 * The opencode CLI branch is NOT exercised here because it requires a live
 * external CLI binary and has separate integration coverage.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseOpenCodeModelsOutput, OpenCodeProvider } from "../src/core/providers/opencode.js";
import { ClaudeCodeProvider } from "../src/core/providers/claude-code.js";
import { CodexProvider, parseCodexModelsOutput } from "../src/core/providers/codex.js";

describe("parseOpenCodeModelsOutput", () => {
  it("parses well-formed provider/model lines", () => {
    const out = parseOpenCodeModelsOutput("anthropic/claude-sonnet-4-6\nopenai/gpt-4o\n");
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], {
      id: "anthropic/claude-sonnet-4-6",
      label: "anthropic/claude-sonnet-4-6",
      provider: "anthropic",
      source: "cli",
    });
    assert.equal(out[1].provider, "openai");
  });

  it("ignores blank lines and lines without slash", () => {
    const out = parseOpenCodeModelsOutput("\nanthropic/claude-haiku\nstray-no-slash\n\n");
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "anthropic/claude-haiku");
  });

  it("handles trailing whitespace and CRLF", () => {
    const out = parseOpenCodeModelsOutput("anthropic/sonnet  \r\nopenai/gpt-4o\r\n");
    assert.equal(out.length, 2);
    assert.equal(out[0].id, "anthropic/sonnet");
  });

  it("rejects lines with empty provider or model halves", () => {
    const out = parseOpenCodeModelsOutput("/model-only\nprovider-only/\n");
    assert.equal(out.length, 0);
  });
});

describe("ClaudeCodeProvider.listModels (static branch)", () => {
  it("returns the curated Anthropic catalog when no baseUrl is given", async () => {
    const p = new ClaudeCodeProvider();
    const result = await p.listModels?.();
    assert.ok(result, "listModels should be defined on ClaudeCodeProvider");
    assert.equal(result!.source, "static");
    assert.ok(result!.models.length > 0, "static catalog should not be empty");
    for (const m of result!.models) {
      assert.equal(m.provider, "anthropic");
      assert.equal(m.source, "static");
      assert.ok(m.id.length > 0);
      assert.ok(m.label.length > 0);
    }
    // Sanity: at least one alias and one full ID present.
    assert.ok(result!.models.some((m) => m.id === "sonnet"));
    assert.ok(result!.models.some((m) => /^claude-/.test(m.id)));
  });
});

describe("parseCodexModelsOutput", () => {
  it("extracts slug + display_name from `codex debug models` JSON", () => {
    const out = parseCodexModelsOutput(JSON.stringify({
      models: [
        { slug: "gpt-5.5", display_name: "GPT-5.5", visibility: "list", supported_in_api: true, description: "Frontier" },
        { slug: "gpt-5.4", display_name: "gpt-5.4", visibility: "list", supported_in_api: true },
      ],
    }));
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], {
      id: "gpt-5.5",
      label: "GPT-5.5",
      provider: "openai",
      source: "cli",
      notes: "Frontier",
    });
    assert.equal(out[1].label, "gpt-5.4");
  });

  it("filters out hidden and unsupported entries", () => {
    const out = parseCodexModelsOutput(JSON.stringify({
      models: [
        { slug: "shown", visibility: "list", supported_in_api: true },
        { slug: "internal", visibility: "hide", supported_in_api: true },
        { slug: "deprecated", visibility: "list", supported_in_api: false },
      ],
    }));
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "shown");
  });

  it("returns [] for malformed JSON or missing models array", () => {
    assert.deepEqual(parseCodexModelsOutput(""), []);
    assert.deepEqual(parseCodexModelsOutput("not-json"), []);
    assert.deepEqual(parseCodexModelsOutput("{}"), []);
    assert.deepEqual(parseCodexModelsOutput(JSON.stringify({ models: "nope" })), []);
  });

  it("falls back to slug when display_name is absent", () => {
    const out = parseCodexModelsOutput(JSON.stringify({
      models: [{ slug: "bare", visibility: "list", supported_in_api: true }],
    }));
    assert.equal(out[0].label, "bare");
  });
});

describe("CodexProvider.listModels (CLI absent → static fallback)", () => {
  it("returns the static catalog when the CLI binary cannot be found", async () => {
    const p = new CodexProvider();
    const result = await p.listModels?.({ cliPath: "/nonexistent/path/codex", refresh: true });
    assert.ok(result);
    assert.equal(result!.source, "static", "fallback should be the static catalog");
    assert.ok(result!.error, "fallback should surface the underlying error");
    assert.ok(result!.models.length > 0);
    for (const m of result!.models) {
      assert.equal(m.provider, "openai");
      assert.equal(m.source, "static");
    }
  });
});

describe("OpenCodeProvider.listModels (CLI absent path)", () => {
  it("returns an error result, not throw, when CLI cannot be resolved", async () => {
    const p = new OpenCodeProvider();
    // Pass an obviously-bad cliPath override → execSync will fail → handler
    // should swallow the error and surface it on the result.
    const result = await p.listModels?.({ cliPath: "/nonexistent/path/opencode", refresh: true });
    assert.ok(result);
    assert.equal(result!.source, "cli");
    assert.ok(result!.error, "should populate error field on CLI failure");
    assert.deepEqual(result!.models, []);
  });
});

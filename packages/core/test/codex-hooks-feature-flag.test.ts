/**
 * Unit tests for `enableCodexHooksFeature` — the helper that writes the
 * `[features].hooks = true` flag into a CODEX_HOME's `config.toml`.
 *
 * Codex CLI 0.130 renamed `codex_hooks` → `hooks`; the helper has to
 * (a) write the new key on fresh installs, (b) migrate legacy keys in
 * place, (c) merge safely into an existing `[features]` table without
 * producing a duplicate-table-definition.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { enableCodexHooksFeature } from "../src/core/providers/codex.js";

describe("enableCodexHooksFeature", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sna-codex-hooks-"));
    configPath = path.join(tmpDir, "config.toml");
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it("creates a [features] table with `hooks = true` when the file is empty/missing", () => {
    // file doesn't exist yet
    enableCodexHooksFeature(configPath);
    const content = fs.readFileSync(configPath, "utf8");
    assert.match(content, /^\[features\]\s*$/m);
    assert.match(content, /^hooks\s*=\s*true\s*$/m);
    assert.doesNotMatch(content, /codex_hooks/);
  });

  it("injects `hooks = true` inside an existing [features] table instead of appending a duplicate", () => {
    fs.writeFileSync(configPath, [
      "model = \"gpt-5.5\"",
      "",
      "[features]",
      "run_logs = true",
      "",
    ].join("\n"));

    enableCodexHooksFeature(configPath);
    const content = fs.readFileSync(configPath, "utf8");

    // Only one [features] header.
    const headerCount = content.match(/^\[features\]\s*$/gm)?.length ?? 0;
    assert.equal(headerCount, 1, "should not duplicate the [features] table");
    // Both keys present.
    assert.match(content, /^hooks\s*=\s*true\s*$/m);
    assert.match(content, /^run_logs\s*=\s*true\s*$/m);
    // hooks sits directly under [features], above the pre-existing key.
    assert.match(content, /\[features\]\s*\nhooks\s*=\s*true\s*\nrun_logs\s*=\s*true/);
  });

  it("migrates legacy `codex_hooks = …` to `hooks = …` in place", () => {
    fs.writeFileSync(configPath, [
      "[features]",
      "codex_hooks = true",
      "",
    ].join("\n"));

    enableCodexHooksFeature(configPath);
    const content = fs.readFileSync(configPath, "utf8");

    assert.match(content, /^hooks\s*=\s*true\s*$/m);
    assert.doesNotMatch(content, /codex_hooks/);
  });

  it("preserves the legacy key's RHS during migration (e.g. `= false` stays `= false`)", () => {
    fs.writeFileSync(configPath, [
      "[features]",
      "codex_hooks = false",
      "",
    ].join("\n"));

    enableCodexHooksFeature(configPath);
    const content = fs.readFileSync(configPath, "utf8");

    assert.match(content, /^hooks\s*=\s*false\s*$/m);
    assert.doesNotMatch(content, /codex_hooks/);
  });

  it("is a no-op when `hooks = …` already exists", () => {
    const before = [
      "[features]",
      "hooks = true",
      "other_flag = false",
      "",
    ].join("\n");
    fs.writeFileSync(configPath, before);

    enableCodexHooksFeature(configPath);
    const after = fs.readFileSync(configPath, "utf8");

    assert.equal(after, before);
  });

  it("when both legacy and new keys somehow coexist, leaves the file untouched", () => {
    const before = [
      "[features]",
      "hooks = true",
      "codex_hooks = true",
      "",
    ].join("\n");
    fs.writeFileSync(configPath, before);

    enableCodexHooksFeature(configPath);
    const after = fs.readFileSync(configPath, "utf8");

    // We don't try to delete the legacy line — the new key already wins
    // and a stray line is harmless. Just confirm nothing got duplicated.
    assert.equal(after, before);
  });

  it("appends a fresh [features] section when no existing one is present", () => {
    fs.writeFileSync(configPath, "model = \"gpt-5.5\"\n");

    enableCodexHooksFeature(configPath);
    const content = fs.readFileSync(configPath, "utf8");

    assert.match(content, /model\s*=\s*"gpt-5\.5"/);
    assert.match(content, /\[features\]\s*\nhooks\s*=\s*true/);
  });
});

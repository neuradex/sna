import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCommandVOutput } from "../src/core/providers/claude-code.js";

describe("parseCommandVOutput", () => {
  // ── Direct absolute paths ──────────────────────────────────────────────────

  it("Homebrew ARM: /opt/homebrew/bin/claude", () => {
    assert.equal(parseCommandVOutput("/opt/homebrew/bin/claude"), "/opt/homebrew/bin/claude");
  });

  it("Homebrew Intel: /usr/local/bin/claude", () => {
    assert.equal(parseCommandVOutput("/usr/local/bin/claude"), "/usr/local/bin/claude");
  });

  it("nvm: ~/.nvm/versions/node/vXX/bin/claude", () => {
    assert.equal(parseCommandVOutput("/Users/user/.nvm/versions/node/v24.14.1/bin/claude"), "/Users/user/.nvm/versions/node/v24.14.1/bin/claude");
  });

  it("fnm: ~/.fnm/aliases/default/bin/claude", () => {
    assert.equal(parseCommandVOutput("/Users/user/.fnm/aliases/default/bin/claude"), "/Users/user/.fnm/aliases/default/bin/claude");
  });

  it("asdf: ~/.asdf/shims/claude", () => {
    assert.equal(parseCommandVOutput("/Users/user/.asdf/shims/claude"), "/Users/user/.asdf/shims/claude");
  });

  it("volta: ~/.volta/bin/claude", () => {
    assert.equal(parseCommandVOutput("/Users/user/.volta/bin/claude"), "/Users/user/.volta/bin/claude");
  });

  it("pnpm global: ~/.local/share/pnpm/claude", () => {
    assert.equal(parseCommandVOutput("/Users/user/.local/share/pnpm/claude"), "/Users/user/.local/share/pnpm/claude");
  });

  it("Claude desktop CLI: ~/.claude/bin/claude", () => {
    assert.equal(parseCommandVOutput("/Users/user/.claude/bin/claude"), "/Users/user/.claude/bin/claude");
  });

  it("npm global: /usr/local/lib/node_modules/.bin/claude", () => {
    assert.equal(parseCommandVOutput("/usr/local/lib/node_modules/.bin/claude"), "/usr/local/lib/node_modules/.bin/claude");
  });

  it("Linux snap: /snap/bin/claude", () => {
    assert.equal(parseCommandVOutput("/snap/bin/claude"), "/snap/bin/claude");
  });

  it("Linux usr: /usr/bin/claude", () => {
    assert.equal(parseCommandVOutput("/usr/bin/claude"), "/usr/bin/claude");
  });

  // ── Alias formats ─────────────────────────────────────────────────────────

  it("alias without quotes: alias claude=/opt/homebrew/bin/claude", () => {
    assert.equal(parseCommandVOutput("alias claude=/opt/homebrew/bin/claude"), "/opt/homebrew/bin/claude");
  });

  it("alias with single quotes: alias claude='/opt/homebrew/bin/claude'", () => {
    assert.equal(parseCommandVOutput("alias claude='/opt/homebrew/bin/claude'"), "/opt/homebrew/bin/claude");
  });

  it("alias with double quotes: alias claude=\"/opt/homebrew/bin/claude\"", () => {
    assert.equal(parseCommandVOutput('alias claude="/opt/homebrew/bin/claude"'), "/opt/homebrew/bin/claude");
  });

  it("alias with nvm path", () => {
    assert.equal(parseCommandVOutput("alias claude=/Users/user/.nvm/versions/node/v24.14.1/bin/claude"), "/Users/user/.nvm/versions/node/v24.14.1/bin/claude");
  });

  it("alias with spaces around =", () => {
    assert.equal(parseCommandVOutput("alias claude= /opt/homebrew/bin/claude"), "/opt/homebrew/bin/claude");
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  it("empty string → fallback to 'claude'", () => {
    assert.equal(parseCommandVOutput(""), "claude");
  });

  it("bare 'claude' (shell function or not found) → returns as-is", () => {
    assert.equal(parseCommandVOutput("claude"), "claude");
  });

  it("whitespace-only → fallback to 'claude'", () => {
    assert.equal(parseCommandVOutput("   \n  "), "claude");
  });

  it("path with trailing newline", () => {
    assert.equal(parseCommandVOutput("/opt/homebrew/bin/claude\n"), "/opt/homebrew/bin/claude");
  });

  it("path with leading/trailing whitespace", () => {
    assert.equal(parseCommandVOutput("  /opt/homebrew/bin/claude  "), "/opt/homebrew/bin/claude");
  });
});

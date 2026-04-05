import { describe, it, expect } from "vitest";
import { parseCommandVOutput } from "../src/core/providers/claude-code.js";

describe("parseCommandVOutput", () => {
  // ── Direct absolute paths ──────────────────────────────────────────────────

  it("Homebrew ARM: /opt/homebrew/bin/claude", () => {
    expect(parseCommandVOutput("/opt/homebrew/bin/claude")).toBe("/opt/homebrew/bin/claude");
  });

  it("Homebrew Intel: /usr/local/bin/claude", () => {
    expect(parseCommandVOutput("/usr/local/bin/claude")).toBe("/usr/local/bin/claude");
  });

  it("nvm: ~/.nvm/versions/node/vXX/bin/claude", () => {
    expect(parseCommandVOutput("/Users/user/.nvm/versions/node/v24.14.1/bin/claude"))
      .toBe("/Users/user/.nvm/versions/node/v24.14.1/bin/claude");
  });

  it("fnm: ~/.fnm/aliases/default/bin/claude", () => {
    expect(parseCommandVOutput("/Users/user/.fnm/aliases/default/bin/claude"))
      .toBe("/Users/user/.fnm/aliases/default/bin/claude");
  });

  it("asdf: ~/.asdf/shims/claude", () => {
    expect(parseCommandVOutput("/Users/user/.asdf/shims/claude"))
      .toBe("/Users/user/.asdf/shims/claude");
  });

  it("volta: ~/.volta/bin/claude", () => {
    expect(parseCommandVOutput("/Users/user/.volta/bin/claude"))
      .toBe("/Users/user/.volta/bin/claude");
  });

  it("pnpm global: ~/.local/share/pnpm/claude", () => {
    expect(parseCommandVOutput("/Users/user/.local/share/pnpm/claude"))
      .toBe("/Users/user/.local/share/pnpm/claude");
  });

  it("Claude desktop CLI: ~/.claude/bin/claude", () => {
    expect(parseCommandVOutput("/Users/user/.claude/bin/claude"))
      .toBe("/Users/user/.claude/bin/claude");
  });

  it("npm global: /usr/local/lib/node_modules/.bin/claude", () => {
    expect(parseCommandVOutput("/usr/local/lib/node_modules/.bin/claude"))
      .toBe("/usr/local/lib/node_modules/.bin/claude");
  });

  it("Linux snap: /snap/bin/claude", () => {
    expect(parseCommandVOutput("/snap/bin/claude")).toBe("/snap/bin/claude");
  });

  it("Linux usr: /usr/bin/claude", () => {
    expect(parseCommandVOutput("/usr/bin/claude")).toBe("/usr/bin/claude");
  });

  // ── Alias formats ─────────────────────────────────────────────────────────

  it("alias without quotes: alias claude=/opt/homebrew/bin/claude", () => {
    expect(parseCommandVOutput("alias claude=/opt/homebrew/bin/claude"))
      .toBe("/opt/homebrew/bin/claude");
  });

  it("alias with single quotes: alias claude='/opt/homebrew/bin/claude'", () => {
    expect(parseCommandVOutput("alias claude='/opt/homebrew/bin/claude'"))
      .toBe("/opt/homebrew/bin/claude");
  });

  it("alias with double quotes: alias claude=\"/opt/homebrew/bin/claude\"", () => {
    expect(parseCommandVOutput('alias claude="/opt/homebrew/bin/claude"'))
      .toBe("/opt/homebrew/bin/claude");
  });

  it("alias with nvm path", () => {
    expect(parseCommandVOutput("alias claude=/Users/user/.nvm/versions/node/v24.14.1/bin/claude"))
      .toBe("/Users/user/.nvm/versions/node/v24.14.1/bin/claude");
  });

  it("alias with spaces around =", () => {
    expect(parseCommandVOutput("alias claude= /opt/homebrew/bin/claude"))
      .toBe("/opt/homebrew/bin/claude");
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  it("empty string → fallback to 'claude'", () => {
    expect(parseCommandVOutput("")).toBe("claude");
  });

  it("bare 'claude' (shell function or not found) → returns as-is", () => {
    expect(parseCommandVOutput("claude")).toBe("claude");
  });

  it("whitespace-only → fallback to 'claude'", () => {
    expect(parseCommandVOutput("   \n  ")).toBe("claude");
  });

  it("path with trailing newline", () => {
    expect(parseCommandVOutput("/opt/homebrew/bin/claude\n"))
      .toBe("/opt/homebrew/bin/claude");
  });

  it("path with leading/trailing whitespace", () => {
    expect(parseCommandVOutput("  /opt/homebrew/bin/claude  "))
      .toBe("/opt/homebrew/bin/claude");
  });
});

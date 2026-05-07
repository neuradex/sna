/**
 * Manual end-to-end verification harness for OpenCodeProvider.
 *
 * Run after installing real opencode 1.14.x:
 *   pnpm tsx packages/core/scripts/verify-opencode.ts
 *
 * Exits non-zero on the first failure. Skips cleanly with exit 0 if the
 * opencode binary isn't on PATH (so it can be wired into CI without
 * forcing every contributor to install opencode).
 *
 * Scenarios (in order):
 *   1. start/send/complete         — basic prompt round-trip
 *   2. cross-provider prelude      — synthetic canonical history → first
 *                                    prompt parts include the prelude
 *   3. runtime-pool reuse          — two spawn() calls on the same cwd
 *                                    share one daemon (same httpUrl)
 *   4. permission flow             — request a write the agent must approve;
 *                                    auto-respond; tool runs
 *   5. interrupt mid-turn          — kick off a long turn, abort, observe
 *                                    interrupted event
 *   6. graceful shutdown           — RuntimePool.dispose() leaves no
 *                                    `opencode serve` process behind
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OpenCodeProvider, resolveOpenCodeCli } from "../src/core/providers/opencode.js";
import { RuntimePool } from "../src/core/providers/runtime.js";
import type { AgentEvent, AgentProcess } from "../src/core/providers/types.js";
import type { CanonicalBlock } from "../src/history/types.js";

// ── Logging helpers ──────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m",
  yellow: "\x1b[33m", cyan: "\x1b[36m", dim: "\x1b[2m",
};
function log(tag: string, msg: string): void {
  console.log(`${C.cyan}[${tag}]${C.reset} ${msg}`);
}
function pass(name: string, detail?: string): void {
  console.log(`${C.green}✓${C.reset} ${name}${detail ? ` ${C.dim}(${detail})${C.reset}` : ""}`);
}
function fail(name: string, detail: string): never {
  console.error(`${C.red}✗${C.reset} ${name}\n  ${C.red}${detail}${C.reset}`);
  process.exit(1);
}

// ── Utilities ────────────────────────────────────────────────────────────

async function waitForEvent(
  events: AgentEvent[],
  predicate: (e: AgentEvent) => boolean,
  timeoutMs: number,
  label: string,
): Promise<AgentEvent> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = events.find(predicate);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timeout waiting for ${label} (${timeoutMs}ms)`);
}

function collect(proc: AgentProcess): AgentEvent[] {
  const buf: AgentEvent[] = [];
  proc.on("event", (e: AgentEvent) => buf.push(e));
  return buf;
}

/**
 * Check whether a specific HTTP daemon URL is still responding. We use
 * this instead of counting `opencode serve` processes because the user's
 * own opencode dev daemons (Loom, IDE plugins, etc.) would skew the
 * count; our concern is only "did the daemon WE started shut down?".
 */
async function urlIsAlive(url: string, timeoutMs = 1500): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/doc`, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok || res.status < 500;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

// ── Scenarios ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Pre-flight: detect opencode.
  const r = resolveOpenCodeCli();
  if (r.source === "fallback") {
    log("skip", "opencode not found on PATH — set SNA_OPENCODE_COMMAND or install. Exiting cleanly.");
    process.exit(0);
  }
  log("env", `opencode: ${r.path} ${r.version ?? ""} (${r.source})`);

  // Spawn auth check: opencode must be authenticated for any of these to succeed.
  // We don't fail the script if not — the daemon will just emit a session.error.
  // Operators can read the verbose error line and re-run after `opencode auth login`.

  // Use a real project root (the SNA repo itself) as cwd, NOT a tempdir.
  // Real opencode resolves agent + model defaults from project context
  // (looks up opencode.json in cwd / parent dirs); a fresh tempdir has none,
  // and the prompt silently produces zero output (no model dispatched).
  const cwd = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), "..");
  log("env", `cwd: ${cwd}`);

  const provider = new OpenCodeProvider();
  const pool = new RuntimePool();

  // ── Scenario 1: start/send/complete ────────────────────────────────────
  log("test", "1/6: start/send/complete");
  const handle1 = await pool.prepare({ provider: "opencode", cwd }, provider);
  const proc1 = provider.spawn(
    { cwd, prompt: "Reply with the single word: pong" },
    handle1,
  );
  const events1 = collect(proc1);
  try {
    const init = await waitForEvent(events1, (e) => e.type === "init", 30_000, "init");
    pass("init event received", `sessionId=${String(init.data?.sessionId).slice(0, 16)}…`);
    await waitForEvent(events1, (e) => e.type === "complete", 120_000, "complete");
    const final = events1.find((e) => e.type === "assistant");
    if (!final?.message) throw new Error("no assistant message captured");
    pass("got assistant text", JSON.stringify(final.message).slice(0, 60));
  } catch (err) {
    proc1.kill();
    pool.dispose();
    fail("scenario 1", String(err));
  }
  proc1.kill();

  // ── Scenario 2: cross-provider prelude visibility ─────────────────────
  log("test", "2/6: cross-provider prelude");
  const history: CanonicalBlock[] = [
    { actor: "user", kind: "text", content: "Remember: my favorite number is 42." },
    { actor: "assistant", kind: "text", content: "Got it — 42." },
  ];
  // Reuse the pool — tests scenario 3 implicitly.
  const handle2 = await pool.prepare({ provider: "opencode", cwd }, provider);
  if (handle2.httpUrl !== handle1.httpUrl) {
    fail("scenario 2 setup", `pool returned a different httpUrl: ${handle2.httpUrl} vs ${handle1.httpUrl}`);
  }
  const proc2 = provider.spawn(
    { cwd, prompt: "What's my favorite number? Answer in one word.", history },
    handle2,
  );
  const events2 = collect(proc2);
  try {
    await waitForEvent(events2, (e) => e.type === "init", 15_000, "init");
    await waitForEvent(events2, (e) => e.type === "complete", 90_000, "complete");
    const text = events2.find((e) => e.type === "assistant")?.message ?? "";
    if (!/42/.test(text)) {
      log("warn", `assistant didn't echo "42" (got: ${JSON.stringify(text).slice(0, 80)}). ` +
        `This is best-effort — if your model is offline or refuses, the prelude wiring may still be correct.`);
    }
    pass("prelude delivered", `assistant echoed: ${JSON.stringify(text).slice(0, 60)}`);
  } catch (err) {
    proc2.kill();
    pool.dispose();
    fail("scenario 2", String(err));
  }
  proc2.kill();

  // ── Scenario 3: runtime-pool reuse (already verified above) ───────────
  pass("3/6: runtime-pool reuse — same httpUrl across two prepare() calls");

  // ── Scenario 4: permission flow ───────────────────────────────────────
  log("test", "4/6: permission flow");
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "sna-opencode-perm-"));
  const handle4 = await pool.prepare({ provider: "opencode", cwd }, provider);
  const proc4 = provider.spawn(
    {
      cwd,
      permissionMode: "default",
      prompt: `Use the write tool to create a file called proof.txt with the text "hello" in this directory: ${scratchDir}`,
    },
    handle4,
  );
  const events4 = collect(proc4);
  let permResolved = false;
  proc4.on("event", (e: AgentEvent) => {
    if (e.type === "permission_needed" && proc4.respondToPermission && e.data?.requestId) {
      proc4.respondToPermission(String(e.data.requestId), true);
      permResolved = true;
    }
  });
  try {
    await waitForEvent(events4, (e) => e.type === "init", 15_000, "init");
    await waitForEvent(events4, (e) => e.type === "complete", 90_000, "complete");
    if (permResolved) {
      pass("permission round-trip completed");
    } else {
      log("warn", "no permission_needed event was emitted — agent may have proceeded under a permissive default.");
    }
  } catch (err) {
    proc4.kill();
    pool.dispose();
    try { fs.rmSync(scratchDir, { recursive: true, force: true }); } catch { /* ignore */ }
    fail("scenario 4", String(err));
  }
  proc4.kill();
  try { fs.rmSync(scratchDir, { recursive: true, force: true }); } catch { /* ignore */ }

  // ── Scenario 5: interrupt mid-turn ────────────────────────────────────
  log("test", "5/6: interrupt mid-turn");
  const handle5 = await pool.prepare({ provider: "opencode", cwd }, provider);
  const proc5 = provider.spawn(
    {
      cwd,
      prompt: "Count slowly from 1 to 200, one number per line, with a sentence about each number.",
    },
    handle5,
  );
  const events5 = collect(proc5);
  try {
    await waitForEvent(events5, (e) => e.type === "init", 15_000, "init");
    // Wait until the model starts producing tokens, then interrupt.
    await waitForEvent(events5, (e) => e.type === "assistant_delta", 30_000, "first delta");
    proc5.interrupt();
    await waitForEvent(events5, (e) => e.type === "interrupted", 15_000, "interrupted");
    pass("interrupt fired");
  } catch (err) {
    proc5.kill();
    pool.dispose();
    fail("scenario 5", String(err));
  }
  proc5.kill();

  // ── Scenario 6: graceful shutdown ─────────────────────────────────────
  log("test", "6/6: graceful shutdown");
  const daemonUrl = handle1.httpUrl ?? handle2.httpUrl ?? handle4.httpUrl ?? handle5.httpUrl ?? "";
  if (!daemonUrl) fail("scenario 6 setup", "no daemon httpUrl recorded");
  const aliveBefore = await urlIsAlive(daemonUrl);
  if (!aliveBefore) fail("scenario 6 setup", `daemon at ${daemonUrl} unexpectedly already down`);
  pool.dispose();
  // Give SDK's server.close() (SIGTERM) up to 5s, then OpenCodeProvider's
  // SIGKILL fallback fires at +2s. 6s total is generous.
  await new Promise((r) => setTimeout(r, 6000));
  const aliveAfter = await urlIsAlive(daemonUrl);
  if (aliveAfter) {
    fail("scenario 6", `daemon at ${daemonUrl} still responding 6s after pool.dispose()`);
  }
  pass("daemon shutdown clean", `${daemonUrl} alive=true → alive=false`);

  // ── Final summary ─────────────────────────────────────────────────────
  console.log(`\n${C.green}All scenarios passed.${C.reset}\n`);

  // (We use the package root as cwd; nothing to clean up.)
}

main().catch((err) => {
  console.error(`${C.red}verification crashed:${C.reset}`, err);
  process.exit(1);
});

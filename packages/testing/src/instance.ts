/**
 * Instance management — Docker-like named test instances.
 *
 * Each `sna-test claude` run creates an instance with a unique name
 * (adjective-noun pair). All logs for that run are stored under
 * `.sna/instances/<name>/`.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

const ADJECTIVES = [
  "happy", "calm", "bold", "warm", "cool", "swift", "bright", "quiet",
  "gentle", "keen", "brave", "lucky", "vivid", "wise", "proud", "kind",
  "wild", "sharp", "soft", "clear", "quick", "light", "fair", "free",
];

const NOUNS = [
  "bear", "fox", "wolf", "hawk", "deer", "owl", "seal", "hare",
  "lynx", "crow", "dove", "wren", "moth", "frog", "bee", "elk",
  "ram", "ray", "cod", "ant", "eel", "jay", "yak", "puma",
];

function randomPick<T>(arr: T[]): T {
  return arr[crypto.randomInt(arr.length)];
}

export function generateInstanceName(): string {
  return `${randomPick(ADJECTIVES)}-${randomPick(NOUNS)}`;
}

export function getInstancesDir(): string {
  return path.join(process.cwd(), ".sna/instances");
}

export function getInstanceDir(name: string): string {
  return path.join(getInstancesDir(), name);
}

export interface InstanceMeta {
  name: string;
  mode: "oneshot" | "interactive";
  command: string;
  createdAt: string;
  pid?: number;
  mockPort?: number;
  exitCode?: number | null;
  status: "running" | "done" | "error";
}

export function writeInstanceMeta(name: string, meta: InstanceMeta): void {
  const dir = getInstanceDir(name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
}

export function readInstanceMeta(name: string): InstanceMeta | null {
  try {
    const raw = fs.readFileSync(path.join(getInstanceDir(name), "meta.json"), "utf8");
    return JSON.parse(raw);
  } catch { return null; }
}

export function listInstances(): InstanceMeta[] {
  const dir = getInstancesDir();
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const instances: InstanceMeta[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = readInstanceMeta(entry.name);
    if (meta) {
      // Check if "running" instance is actually still alive
      if (meta.status === "running" && meta.pid) {
        try { process.kill(meta.pid, 0); } catch {
          meta.status = "done";
          writeInstanceMeta(entry.name, meta);
        }
      }
      instances.push(meta);
    }
  }
  return instances.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function removeInstance(name: string): boolean {
  const dir = getInstanceDir(name);
  if (!fs.existsSync(dir)) return false;
  // Kill process if still running
  const meta = readInstanceMeta(name);
  if (meta?.pid && meta.status === "running") {
    try { process.kill(meta.pid, "SIGTERM"); } catch {}
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

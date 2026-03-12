import { NextResponse } from "next/server";
import { getDb } from "@/db/schema";

export const runtime = "nodejs";

export async function GET() {
  const db = getDb();

  const summary = {
    total_commits: (db.prepare("SELECT COUNT(*) as n FROM commits").get() as any).n,
    total_insertions: (db.prepare("SELECT SUM(insertions) as n FROM commits").get() as any).n ?? 0,
    active_repos: (db.prepare("SELECT COUNT(DISTINCT repo) as n FROM commits").get() as any).n,
    active_days: (db.prepare("SELECT COUNT(DISTINCT date) as n FROM commits").get() as any).n,
  };

  const by_date = db.prepare(`
    SELECT date, COUNT(*) as commits, SUM(insertions) as insertions
    FROM commits GROUP BY date ORDER BY date DESC LIMIT 30
  `).all();

  const by_repo = db.prepare(`
    SELECT repo, COUNT(*) as commits, SUM(insertions) as insertions
    FROM commits GROUP BY repo ORDER BY commits DESC LIMIT 10
  `).all();

  const by_hour = db.prepare(`
    SELECT substr(time, 1, 2) as hour, COUNT(*) as commits
    FROM commits GROUP BY hour ORDER BY hour
  `).all();

  const recent = db.prepare(`
    SELECT date, time, repo, message, insertions, deletions
    FROM commits ORDER BY date DESC, time DESC LIMIT 15
  `).all();

  const notes = db.prepare(`
    SELECT date, note FROM analysis_notes ORDER BY created_at DESC LIMIT 5
  `).all();

  return NextResponse.json({ summary, by_date, by_repo, by_hour, recent, notes });
}

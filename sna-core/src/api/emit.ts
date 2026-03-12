import { getDb } from "../db/schema.js";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { skill, type, message, data } = await req.json();

  if (!skill || !type || !message) {
    return Response.json({ error: "missing fields" }, { status: 400 });
  }

  const db = getDb();
  const result = db.prepare(
    `INSERT INTO skill_events (skill, type, message, data) VALUES (?, ?, ?, ?)`
  ).run(skill, type, message, data ?? null);

  return Response.json({ id: result.lastInsertRowid });
}

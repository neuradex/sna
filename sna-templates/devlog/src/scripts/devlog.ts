/**
 * devlog.ts — CLI for Dev Coding Tracker
 *
 * Commands:
 *   collect  [--repos "path1,path2"] [--since "2025-03-01"]
 *   list     [--limit 20] [--date YYYY-MM-DD]
 *   stats
 *   export   → prints JSON for Claude to analyze
 *   add-note --note "insight text"
 */

import { execSync } from "child_process";
import { getDb, type Entry } from "../db/schema.js";
import path from "path";
import os from "os";

const [, , command, ...args] = process.argv;
const db = getDb();

function parseArgs(rawArgs: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < rawArgs.length; i += 2) {
    const key = rawArgs[i]?.replace(/^--/, "");
    if (key) result[key] = rawArgs[i + 1] ?? "";
  }
  return result;
}

/** Find git repos under common locations */
function discoverRepos(baseDirs: string[]): string[] {
  const repos: string[] = [];
  for (const dir of baseDirs) {
    try {
      const result = execSync(
        `find "${dir}" -maxdepth 3 -name ".git" -type d 2>/dev/null | head -30`,
        { encoding: "utf8" }
      );
      for (const gitDir of result.trim().split("\n").filter(Boolean)) {
        repos.push(path.dirname(gitDir));
      }
    } catch {
      // skip unreadable dirs
    }
  }
  return repos;
}

interface GitCommit {
  hash: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  message: string;
  repo: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

function getCommitsFromRepo(repoPath: string, since: string): GitCommit[] {
  try {
    // Get author email to filter own commits
    let authorEmail = "";
    try {
      authorEmail = execSync("git config user.email", {
        encoding: "utf8",
        cwd: repoPath,
      }).trim();
    } catch {
      // proceed without filter
    }

    const authorFilter = authorEmail ? `--author="${authorEmail}"` : "";
    const logOutput = execSync(
      `git log ${authorFilter} --since="${since}" --format="%H|%ci|%s" 2>/dev/null`,
      { encoding: "utf8", cwd: repoPath }
    ).trim();

    if (!logOutput) return [];

    const commits: GitCommit[] = [];
    for (const line of logOutput.split("\n").filter(Boolean)) {
      const [hash, datetime, ...msgParts] = line.split("|");
      const message = msgParts.join("|");
      const dateObj = new Date(datetime);
      const date = dateObj.toISOString().slice(0, 10);
      const time = dateObj.toTimeString().slice(0, 5);

      // Get stat for this commit
      let filesChanged = 0;
      let insertions = 0;
      let deletions = 0;
      try {
        const stat = execSync(`git show --stat "${hash}" 2>/dev/null | tail -1`, {
          encoding: "utf8",
          cwd: repoPath,
        }).trim();
        const fMatch = stat.match(/(\d+) file/);
        const iMatch = stat.match(/(\d+) insertion/);
        const dMatch = stat.match(/(\d+) deletion/);
        if (fMatch) filesChanged = parseInt(fMatch[1]);
        if (iMatch) insertions = parseInt(iMatch[1]);
        if (dMatch) deletions = parseInt(dMatch[1]);
      } catch {
        // skip stat
      }

      commits.push({
        hash: hash?.slice(0, 8) ?? "",
        date,
        time,
        message: message?.trim() ?? "",
        repo: path.basename(repoPath),
        filesChanged,
        insertions,
        deletions,
      });
    }
    return commits;
  } catch {
    return [];
  }
}

switch (command) {
  case "collect": {
    const flags = parseArgs(args);
    const since = flags.since ?? new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);

    // Determine repos to scan
    let repoPaths: string[];
    if (flags.repos) {
      repoPaths = flags.repos.split(",").map((r) => r.trim());
    } else {
      const defaultDirs = [
        path.join(os.homedir(), "neuradex"),
        path.join(os.homedir(), "works"),
        path.join(os.homedir(), "projects"),
        path.join(os.homedir(), "dev"),
      ];
      repoPaths = discoverRepos(defaultDirs);
    }

    console.log(`Scanning ${repoPaths.length} repos since ${since}...`);

    const insert = db.prepare(`
      INSERT OR IGNORE INTO commits (hash, date, time, message, repo, files_changed, insertions, deletions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let totalAdded = 0;
    for (const repoPath of repoPaths) {
      const commits = getCommitsFromRepo(repoPath, since);
      for (const c of commits) {
        const result = insert.run(c.hash, c.date, c.time, c.message, c.repo, c.filesChanged, c.insertions, c.deletions);
        if (result.changes > 0) totalAdded++;
      }
      if (commits.length > 0) {
        console.log(`  ${path.basename(repoPath)}: ${commits.length} commits`);
      }
    }
    console.log(`\n✓ Added ${totalAdded} new commits`);
    break;
  }

  case "list": {
    const flags = parseArgs(args);
    const limit = parseInt(flags.limit ?? "30");
    const dateFilter = flags.date;

    const rows = dateFilter
      ? db.prepare("SELECT * FROM commits WHERE date = ? ORDER BY time DESC LIMIT ?").all(dateFilter, limit)
      : db.prepare("SELECT * FROM commits ORDER BY date DESC, time DESC LIMIT ?").all(limit);

    if (rows.length === 0) {
      console.log('No commits found. Run: tsx src/scripts/devlog.ts collect');
      break;
    }

    let lastDate = "";
    for (const row of rows as any[]) {
      if (row.date !== lastDate) {
        console.log(`\n── ${row.date} ──`);
        lastDate = row.date;
      }
      const lines = row.insertions + row.deletions;
      console.log(`  ${row.time} [${row.repo}] ${row.message} (+${row.insertions}/-${row.deletions})`);
    }
    break;
  }

  case "stats": {
    const total = (db.prepare("SELECT COUNT(*) as n FROM commits").get() as any).n;
    const byRepo = db.prepare(`
      SELECT repo, COUNT(*) as commits, SUM(insertions) as lines_added
      FROM commits GROUP BY repo ORDER BY commits DESC LIMIT 10
    `).all();
    const byDay = db.prepare(`
      SELECT date, COUNT(*) as commits FROM commits
      GROUP BY date ORDER BY date DESC LIMIT 14
    `).all();
    const hourly = db.prepare(`
      SELECT substr(time, 1, 2) as hour, COUNT(*) as commits
      FROM commits GROUP BY hour ORDER BY commits DESC LIMIT 5
    `).all();

    console.log(`\n=== Coding Stats ===`);
    console.log(`Total commits tracked: ${total}`);
    console.log(`\nTop repos:`);
    for (const r of byRepo as any[]) {
      console.log(`  ${r.repo}: ${r.commits} commits, +${r.lines_added ?? 0} lines`);
    }
    console.log(`\nMost productive hours:`);
    for (const h of hourly as any[]) {
      console.log(`  ${h.hour}:00 → ${h.commits} commits`);
    }
    console.log(`\nRecent days:`);
    for (const d of byDay as any[]) {
      console.log(`  ${(d as any).date}: ${(d as any).commits} commits`);
    }
    break;
  }

  case "export": {
    // JSON export for Claude to read during analysis skill
    const stats = {
      total_commits: (db.prepare("SELECT COUNT(*) as n FROM commits").get() as any).n,
      by_repo: db.prepare(`
        SELECT repo, COUNT(*) as commits, SUM(insertions) as insertions, SUM(deletions) as deletions
        FROM commits GROUP BY repo ORDER BY commits DESC
      `).all(),
      by_date: db.prepare(`
        SELECT date, COUNT(*) as commits, SUM(insertions) as insertions
        FROM commits GROUP BY date ORDER BY date DESC LIMIT 30
      `).all(),
      by_hour: db.prepare(`
        SELECT substr(time, 1, 2) as hour, COUNT(*) as commits
        FROM commits GROUP BY hour ORDER BY commits DESC
      `).all(),
      recent_commits: db.prepare(`
        SELECT date, time, repo, message, insertions, deletions
        FROM commits ORDER BY date DESC, time DESC LIMIT 20
      `).all(),
    };
    console.log(JSON.stringify(stats, null, 2));
    break;
  }

  case "add-note": {
    const flags = parseArgs(args);
    if (!flags.note) { console.error("Error: --note is required"); process.exit(1); }
    db.prepare("INSERT INTO analysis_notes (note) VALUES (?)").run(flags.note);
    console.log("✓ Note saved");
    break;
  }

  default:
    console.log(`
Dev Coding Tracker — Skills-Native Application demo

Commands:
  collect   [--repos "path1,path2"] [--since "YYYY-MM-DD"]
  list      [--limit 30] [--date YYYY-MM-DD]
  stats
  export    (prints JSON for Claude analysis)
  add-note  --note "insight text"
    `.trim());
}

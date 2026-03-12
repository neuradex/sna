import { getDb } from "../db/schema.js";

const db = getDb();

const count = (db.prepare("SELECT COUNT(*) as n FROM commits").get() as { n: number }).n;

if (count === 0) {
  // Seed with realistic-looking example data
  const insert = db.prepare(`
    INSERT OR IGNORE INTO commits (hash, date, time, message, repo, files_changed, insertions, deletions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seed = db.transaction(() => {
    insert.run("a1b2c3d4", "2025-03-08", "10:32", "feat: add SQLite integration", "skills-native-app", 3, 120, 5);
    insert.run("b2c3d4e5", "2025-03-08", "14:17", "fix: correct module resolution for better-sqlite3", "skills-native-app", 1, 8, 3);
    insert.run("c3d4e5f6", "2025-03-08", "16:45", "docs: update README with quickstart", "skills-native-app", 1, 40, 10);
    insert.run("d4e5f6a7", "2025-03-09", "09:15", "feat: implement git log collector script", "skills-native-app", 2, 180, 0);
    insert.run("e5f6a7b8", "2025-03-09", "11:30", "refactor: extract db client from schema", "neuradex", 4, 60, 45);
    insert.run("f6a7b8c9", "2025-03-09", "15:00", "fix: memory leak in context folding", "context-folding", 1, 12, 8);
    insert.run("a7b8c9d0", "2025-03-10", "08:45", "feat: Skills-Native App landing page", "skills-native-app", 6, 320, 20);
    insert.run("b8c9d0e1", "2025-03-10", "10:20", "feat: devlog dashboard UI", "skills-native-app", 3, 210, 0);
    insert.run("c9d0e1f2", "2025-03-10", "13:55", "chore: add .gitignore and env example", "skills-native-app", 2, 35, 0);
  });
  seed();
  console.log("✓ Database initialized with seed data");
} else {
  console.log(`✓ Database already has ${count} commits, skipping seed`);
}

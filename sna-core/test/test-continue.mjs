import { execSync } from "child_process";

// Clean env
delete process.env.CLAUDECODE;
delete process.env.CLAUDE_CODE_ENTRYPOINT;
delete process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN;

console.log("=== Turn 1 ===");
const t1 = execSync('claude -p --output-format json "remember the number 42"', { encoding: "utf8", timeout: 20000 });
const d1 = JSON.parse(t1);
console.log("Reply:", d1.result?.substring(0, 100));
console.log("Session:", d1.session_id);

console.log("\n=== Turn 2 (--continue) ===");
const t2 = execSync('claude -p --output-format json --continue "what number did I tell you to remember?"', { encoding: "utf8", timeout: 20000 });
const d2 = JSON.parse(t2);
console.log("Reply:", d2.result?.substring(0, 200));

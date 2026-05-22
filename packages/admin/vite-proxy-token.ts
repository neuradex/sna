import fs from "node:fs";
import path from "node:path";

type ProxyEnv = Partial<Pick<
  NodeJS.ProcessEnv,
  "SNA_ADMIN_PROXY_TOKEN" | "SNA_ADMIN_PROXY_TOKEN_PATH" | "SNA_AUTH_TOKEN" | "SNA_DB_PATH"
>>;

function resolvePath(candidate: string, cwd: string): string {
  return path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate);
}

function readTokenFile(candidate: string | undefined, cwd: string): string | undefined {
  if (!candidate?.trim()) return undefined;
  try {
    const token = fs.readFileSync(resolvePath(candidate, cwd), "utf8").trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

function inferredDaemonTokenPath(env: ProxyEnv): string | undefined {
  const dbPath = env.SNA_DB_PATH?.trim();
  if (!dbPath) return undefined;
  return path.join(path.dirname(dbPath), ".sna", "sna-api.token");
}

export function resolveAdminProxyToken(env: ProxyEnv = process.env, cwd = process.cwd()): string | undefined {
  const explicit = env.SNA_ADMIN_PROXY_TOKEN?.trim();
  if (explicit) return explicit;

  const explicitPathToken = readTokenFile(env.SNA_ADMIN_PROXY_TOKEN_PATH, cwd);
  if (explicitPathToken) return explicitPathToken;

  const authToken = env.SNA_AUTH_TOKEN?.trim();
  if (authToken) return authToken;

  return readTokenFile(inferredDaemonTokenPath(env), cwd)
    ?? readTokenFile(".sna/sna-api.token", cwd);
}

import fs from "node:fs";
import path from "node:path";

export interface ClaudeMockEnvOptions {
  /** Project cwd that Claude should trust. Defaults to process.cwd(). */
  cwd?: string;
  /** Anthropic-compatible mock URL, for example http://127.0.0.1:12345. */
  anthropicBaseUrl: string;
  /** Fake API key approved in the isolated Claude config. */
  apiKey?: string;
  /** Claude config directory. Defaults to <cwd>/.sna/mock-claude. */
  configDir?: string;
  /** Base env. Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Extra env appended after mock-specific values. */
  extraEnv?: Record<string, string | undefined>;
  /** When false, only a small shell env allowlist is inherited. */
  inheritEnv?: boolean;
  /** Extra project paths to mark trusted in .claude.json. */
  trustedProjectPaths?: string[];
  /** Rewrite .claude.json even if it already exists. */
  overwrite?: boolean;
}

export interface ClaudeMockEnv {
  env: Record<string, string>;
  cwd: string;
  configDir: string;
  configFile: string;
  apiKey: string;
  anthropicBaseUrl: string;
}

const SAFE_ENV_KEYS = ["PATH", "HOME", "SHELL", "TERM", "LANG", "TMPDIR"] as const;

function compactEnv(input: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Record<string, string>;
}

function baseEnv(options: ClaudeMockEnvOptions): Record<string, string> {
  const source = options.env ?? process.env;
  if (options.inheritEnv !== false) {
    return compactEnv(source);
  }
  const clean: Record<string, string | undefined> = {};
  for (const key of SAFE_ENV_KEYS) clean[key] = source[key];
  return compactEnv(clean);
}

export function createClaudeMockEnv(options: ClaudeMockEnvOptions): ClaudeMockEnv {
  const cwd = options.cwd ?? process.cwd();
  const apiKey = options.apiKey ?? "sk-test-mock-sna";
  const configDir = options.configDir ?? path.join(cwd, ".sna", "mock-claude");
  const configFile = path.join(configDir, ".claude.json");
  fs.mkdirSync(configDir, { recursive: true });

  if (options.overwrite || !fs.existsSync(configFile)) {
    const projects: Record<string, { hasTrustDialogAccepted: boolean }> = {};
    for (const projectPath of [cwd, ...(options.trustedProjectPaths ?? [])]) {
      projects[projectPath] = { hasTrustDialogAccepted: true };
    }

    fs.writeFileSync(configFile, JSON.stringify({
      theme: "dark",
      hasCompletedOnboarding: true,
      customApiKeyResponses: {
        approved: [apiKey.slice(-20)],
        rejected: [],
      },
      projects,
    }, null, 2));
  }

  const env = {
    ...baseEnv(options),
    ANTHROPIC_BASE_URL: options.anthropicBaseUrl,
    ANTHROPIC_API_KEY: apiKey,
    CLAUDE_CONFIG_DIR: configDir,
    ...compactEnv(options.extraEnv ?? {}),
  };

  return {
    env,
    cwd,
    configDir,
    configFile,
    apiKey,
    anthropicBaseUrl: options.anthropicBaseUrl,
  };
}

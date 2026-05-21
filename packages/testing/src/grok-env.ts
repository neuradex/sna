import fs from "node:fs";
import path from "node:path";

export interface GrokMockEnvOptions {
  /** Project cwd for the Grok session. Defaults to process.cwd(). */
  cwd?: string;
  /** OpenAI-compatible mock base URL, for example http://127.0.0.1:12345. */
  openAIBaseUrl: string;
  /** Fake API key exposed through XAI_API_KEY. */
  apiKey?: string;
  /** Isolated HOME for Grok config/auth. Defaults to <cwd>/.sna/mock-grok-home. */
  grokHome?: string;
  /** Model passed to the Grok provider. */
  model?: string;
  /** Base env. Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Extra env appended after mock-specific values. */
  extraEnv?: Record<string, string | undefined>;
  /** When false, only a small shell env allowlist is inherited. */
  inheritEnv?: boolean;
  /** Rewrite config.toml even if it already exists. */
  overwrite?: boolean;
}

export interface GrokMockEnv {
  env: Record<string, string>;
  cwd: string;
  grokHome: string;
  configDir: string;
  configFile: string;
  apiKey: string;
  openAIBaseUrl: string;
  xaiApiBaseUrl: string;
  model: string;
  providerOptions: Record<string, unknown>;
}

const SAFE_ENV_KEYS = ["PATH", "SHELL", "TERM", "LANG", "TMPDIR"] as const;

function compactEnv(input: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Record<string, string>;
}

function baseEnv(options: GrokMockEnvOptions): Record<string, string> {
  const source = options.env ?? process.env;
  if (options.inheritEnv !== false) {
    return compactEnv(source);
  }
  const clean: Record<string, string | undefined> = {};
  for (const key of SAFE_ENV_KEYS) clean[key] = source[key];
  return compactEnv(clean);
}

function quoteToml(value: string | boolean): string {
  return typeof value === "boolean" ? String(value) : JSON.stringify(value);
}

export function createGrokMockEnv(options: GrokMockEnvOptions): GrokMockEnv {
  const cwd = options.cwd ?? process.cwd();
  const apiKey = options.apiKey ?? "sk-test-mock-sna";
  const model = options.model ?? "grok-build";
  const openAIBaseUrl = options.openAIBaseUrl.replace(/\/+$/, "");
  const xaiApiBaseUrl = `${openAIBaseUrl}/v1`;
  const grokHome = options.grokHome ?? path.join(cwd, ".sna", "mock-grok-home");
  const configDir = path.join(grokHome, ".grok");
  const configFile = path.join(configDir, "config.toml");
  fs.mkdirSync(configDir, { recursive: true });

  if (options.overwrite || !fs.existsSync(configFile)) {
    fs.writeFileSync(configFile, [
      `[cli]`,
      `auto_update = ${quoteToml(false)}`,
      `use_leader = ${quoteToml(false)}`,
      ``,
    ].join("\n"));
  }

  const providerOptions = {
    xaiApiBaseUrl,
    noLeader: true,
  };

  const env = {
    ...baseEnv(options),
    HOME: grokHome,
    XAI_API_KEY: apiKey,
    ...compactEnv(options.extraEnv ?? {}),
  };

  return {
    env,
    cwd,
    grokHome,
    configDir,
    configFile,
    apiKey,
    openAIBaseUrl,
    xaiApiBaseUrl,
    model,
    providerOptions,
  };
}

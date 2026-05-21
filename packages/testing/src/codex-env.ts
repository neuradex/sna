import fs from "node:fs";
import path from "node:path";

export interface CodexMockEnvOptions {
  /** Project cwd to mark trusted in the isolated Codex config. Defaults to process.cwd(). */
  cwd?: string;
  /** OpenAI-compatible mock base URL, for example http://127.0.0.1:12345. */
  openAIBaseUrl: string;
  /** Fake API key exposed through OPENAI_API_KEY. */
  apiKey?: string;
  /** Codex home directory. Defaults to <cwd>/.sna/mock-codex. */
  codexHome?: string;
  /** Provider ID written into model_provider and [model_providers.<id>]. */
  providerId?: string;
  /** Default model written into config.toml. */
  model?: string;
  /** Base env. Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Extra env appended after mock-specific values. */
  extraEnv?: Record<string, string | undefined>;
  /** When false, only a small shell env allowlist is inherited. */
  inheritEnv?: boolean;
  /** Extra project paths to mark trusted in config.toml. */
  trustedProjectPaths?: string[];
  /** Rewrite config.toml even if it already exists. */
  overwrite?: boolean;
}

export interface CodexMockEnv {
  env: Record<string, string>;
  cwd: string;
  codexHome: string;
  configFile: string;
  apiKey: string;
  openAIBaseUrl: string;
  providerId: string;
  model: string;
}

const SAFE_ENV_KEYS = ["PATH", "HOME", "SHELL", "TERM", "LANG", "TMPDIR"] as const;

function compactEnv(input: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Record<string, string>;
}

function baseEnv(options: CodexMockEnvOptions): Record<string, string> {
  const source = options.env ?? process.env;
  if (options.inheritEnv !== false) {
    return compactEnv(source);
  }
  const clean: Record<string, string | undefined> = {};
  for (const key of SAFE_ENV_KEYS) clean[key] = source[key];
  return compactEnv(clean);
}

function quoteToml(value: string): string {
  return JSON.stringify(value);
}

export function createCodexMockEnv(options: CodexMockEnvOptions): CodexMockEnv {
  const cwd = options.cwd ?? process.cwd();
  const apiKey = options.apiKey ?? "sk-test-mock-sna";
  const codexHome = options.codexHome ?? path.join(cwd, ".sna", "mock-codex");
  const configFile = path.join(codexHome, "config.toml");
  const providerId = options.providerId ?? "mock-openai";
  const model = options.model ?? "gpt-5.4";
  const baseUrl = options.openAIBaseUrl.replace(/\/+$/, "");
  fs.mkdirSync(codexHome, { recursive: true });

  if (options.overwrite || !fs.existsSync(configFile)) {
    const projects = [cwd, ...(options.trustedProjectPaths ?? [])]
      .map((projectPath) => `[projects.${quoteToml(projectPath)}]\ntrust_level = "trusted"`)
      .join("\n\n");
    fs.writeFileSync(configFile, [
      `model_provider = ${quoteToml(providerId)}`,
      `model = ${quoteToml(model)}`,
      `approval_policy = "never"`,
      `sandbox_mode = "danger-full-access"`,
      ``,
      `[model_providers.${providerId}]`,
      `name = ${quoteToml(providerId)}`,
      `base_url = ${quoteToml(`${baseUrl}/v1`)}`,
      `env_key = "OPENAI_API_KEY"`,
      `wire_api = "responses"`,
      ``,
      projects,
      ``,
    ].join("\n"));
  }

  const env = {
    ...baseEnv(options),
    CODEX_HOME: codexHome,
    OPENAI_API_KEY: apiKey,
    ...compactEnv(options.extraEnv ?? {}),
  };

  return {
    env,
    cwd,
    codexHome,
    configFile,
    apiKey,
    openAIBaseUrl: baseUrl,
    providerId,
    model,
  };
}

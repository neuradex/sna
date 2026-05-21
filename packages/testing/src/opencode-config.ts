import crypto from "node:crypto";

export interface OpenCodeMockConfigOptions {
  /** OpenAI-compatible mock base URL, for example http://127.0.0.1:12345. */
  openAIBaseUrl: string;
  /** Fake API key passed to OpenCode's provider config. */
  apiKey?: string;
  /** OpenCode provider id. Defaults to "sna-mock". */
  providerId?: string;
  /** OpenCode model id under the provider. Defaults to "sna-model". */
  modelId?: string;
  /** Human readable model name shown by OpenCode. */
  modelName?: string;
  /** Agent name to pass through providerOptions.agent. Defaults to "build". */
  agent?: string;
  /** Maximum OpenCode agent loop steps for the generated agent config. */
  maxSteps?: number;
  /** Model context window advertised to OpenCode. */
  contextWindow?: number;
  /** Model output limit advertised to OpenCode. */
  outputLimit?: number;
  /** Merge extra top-level OpenCode config fields after the mock provider config. */
  extraConfig?: Record<string, unknown>;
}

export interface OpenCodeMockConfig {
  config: Record<string, unknown>;
  providerOptions: Record<string, unknown>;
  model: string;
  providerId: string;
  modelId: string;
  apiKey: string;
  openAIBaseUrl: string;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashConfig(config: Record<string, unknown>): string {
  return crypto.createHash("sha256").update(stableJson(config)).digest("hex").slice(0, 16);
}

export function createOpenCodeMockConfig(options: OpenCodeMockConfigOptions): OpenCodeMockConfig {
  const providerId = options.providerId ?? "sna-mock";
  const modelId = options.modelId ?? "sna-model";
  const model = `${providerId}/${modelId}`;
  const apiKey = options.apiKey ?? "sk-test-mock-sna";
  const baseUrl = options.openAIBaseUrl.replace(/\/+$/, "");
  const agent = options.agent ?? "build";
  const maxSteps = options.maxSteps ?? 1;
  const contextWindow = options.contextWindow ?? 8192;
  const outputLimit = options.outputLimit ?? 4096;

  const agentConfig = {
    model,
    maxSteps,
    tools: {},
  };

  const config: Record<string, unknown> = {
    enabled_providers: [providerId],
    model,
    small_model: model,
    plugin: [],
    agent: {
      build: agentConfig,
      [agent]: agentConfig,
    },
    provider: {
      [providerId]: {
        npm: "@ai-sdk/openai-compatible",
        name: "SNA Mock OpenAI",
        options: {
          baseURL: `${baseUrl}/v1`,
          apiKey,
        },
        models: {
          [modelId]: {
            name: options.modelName ?? "SNA Mock Model",
            tool_call: false,
            attachment: false,
            reasoning: false,
            temperature: true,
            cost: { input: 0, output: 0 },
            limit: { context: contextWindow, output: outputLimit },
          },
        },
      },
    },
    ...(options.extraConfig ?? {}),
  };

  return {
    config,
    providerOptions: {
      modelProviderId: providerId,
      opencodeConfig: config,
      opencodeConfigHash: hashConfig(config),
      agent,
    },
    model,
    providerId,
    modelId,
    apiKey,
    openAIBaseUrl: baseUrl,
  };
}

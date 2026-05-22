export { SnaClient } from "./sna-client.js";
export type {
  SnaClientConnection,
  SnaClientOptions,
  ConnectionStatus,
  SessionInfo,
  AgentStartConfig,
  CompletionOptions,
  CompletionResult,
  RunOnceOptions,
  RunOnceResult,
  WsMessage,
  PkceStartOptions,
  PkceRequestInfo,
  PkceStartResponse,
  AuthTokenResponse,
  ListModelsConfig,
  ListModelsResult,
  RuntimeModelInfo,
} from "./sna-client.js";

/**
 * Provider-agnostic reasoning-level scale (0..5, lightest → heaviest).
 * Defined locally so `@sna-sdk/client` stays free of any `@sna-sdk/core`
 * dependency. See {@link AgentStartConfig.reasoningLevel} for the
 * per-provider mapping table.
 */
export type ReasoningLevel = 0 | 1 | 2 | 3 | 4 | 5;

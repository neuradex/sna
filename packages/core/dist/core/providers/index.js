import { ClaudeCodeProvider } from "./claude-code.js";
import { CodexProvider } from "./codex.js";
import { ClaudeCodeProvider as ClaudeCodeProvider2 } from "./claude-code.js";
import { CodexProvider as CodexProvider2 } from "./codex.js";
const providers = {
  "claude-code": new ClaudeCodeProvider2(),
  "codex": new CodexProvider2()
};
function getProvider(name = "claude-code") {
  const provider = providers[name];
  if (!provider) throw new Error(`Unknown agent provider: ${name}`);
  return provider;
}
function registerProvider(provider) {
  providers[provider.name] = provider;
}
export {
  ClaudeCodeProvider,
  CodexProvider,
  getProvider,
  registerProvider
};

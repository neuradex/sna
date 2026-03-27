class CodexProvider {
  constructor() {
    this.name = "codex";
  }
  async isAvailable() {
    return false;
  }
  spawn(_options) {
    throw new Error("Codex provider not yet implemented");
  }
}
export {
  CodexProvider
};

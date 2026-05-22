export interface SnaSession {
  id: string;
  state?: string;
  cwd?: string;
  config?: {
    provider?: string;
    model?: string;
    permissionMode?: string;
  };
}

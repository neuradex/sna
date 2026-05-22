import { useEffect, useState } from "react";
import { RefreshCw, Save, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthToken } from "../auth-token";
import { queryKeys } from "../queries";
import { Panel } from "./ui";

export function ConnectionPanel() {
  const { token, setToken, clearToken } = useAuthToken();
  const [draft, setDraft] = useState(token);
  const queryClient = useQueryClient();

  useEffect(() => setDraft(token), [token]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.health });
    void queryClient.invalidateQueries({ queryKey: queryKeys.authRequests });
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
  };

  return (
    <Panel title="Connection">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          className="focus-ring h-10 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--panel-solid)] px-3 font-mono text-sm text-[var(--fg)] transition placeholder:text-[var(--fg-faint)] focus:border-[var(--accent-border)]"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Auth token"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="flex gap-2">
          <button
            className="focus-ring inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 font-mono text-xs font-medium text-[var(--accent)] transition hover:border-[var(--accent)]"
            type="button"
            onClick={() => setToken(draft)}
          >
            <Save size={16} />
            Save
          </button>
          <button
            className="focus-ring inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-subtle)] px-3 font-mono text-xs font-medium text-[var(--fg-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--fg-soft)]"
            type="button"
            onClick={() => {
              setDraft("");
              clearToken();
            }}
          >
            <Trash2 size={16} />
            Clear
          </button>
          <button
            className="focus-ring inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-subtle)] px-3 font-mono text-xs font-medium text-[var(--fg-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--fg-soft)]"
            type="button"
            onClick={refresh}
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </div>
    </Panel>
  );
}

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
          className="h-10 min-w-0 flex-1 rounded-md border border-stone-300 bg-white px-3 text-sm outline-none transition focus:border-stone-950 focus:ring-2 focus:ring-stone-200"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Auth token"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="flex gap-2">
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md bg-stone-950 px-3 text-sm font-semibold text-white"
            type="button"
            onClick={() => setToken(draft)}
          >
            <Save size={16} />
            Save
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-900"
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
            className="inline-flex h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-900"
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

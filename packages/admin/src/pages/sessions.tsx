import { EmptyState, ErrorText, Panel, StatusBadge } from "../components/ui";
import { useAuthToken } from "../auth-token";
import { useSessionsQuery } from "../queries";

export function SessionsPage() {
  const { token } = useAuthToken();
  const sessions = useSessionsQuery();

  return (
    <Panel title="Sessions">
      {!token ? <EmptyState>Enter an auth token to load sessions.</EmptyState> : null}
      {token && sessions.isError ? <ErrorText error={sessions.error} /> : null}
      {token && sessions.isSuccess && !sessions.data.sessions.length ? <EmptyState>No sessions</EmptyState> : null}
      {token && sessions.isSuccess && sessions.data.sessions.length ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs font-semibold uppercase tracking-normal text-stone-500">
                <th className="py-2 pr-3">ID</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2">Provider</th>
                <th className="px-3 py-2">Model</th>
                <th className="py-2 pl-3">CWD</th>
              </tr>
            </thead>
            <tbody>
              {sessions.data.sessions.map((session) => (
                <tr key={session.id} className="border-b border-stone-100 last:border-0">
                  <td className="py-3 pr-3 font-semibold text-stone-950">{session.id}</td>
                  <td className="px-3 py-3"><StatusBadge>{session.state || "unknown"}</StatusBadge></td>
                  <td className="px-3 py-3 text-stone-700">{session.config?.provider || ""}</td>
                  <td className="px-3 py-3 text-stone-700">{session.config?.model || ""}</td>
                  <td className="max-w-[420px] break-all py-3 pl-3 text-stone-600">{session.cwd || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Panel>
  );
}

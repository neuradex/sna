import { EmptyState, ErrorText, Panel, StatusBadge } from "../components/ui";
import { useSessionsQuery } from "../queries";

export function SessionsPage() {
  const sessions = useSessionsQuery();

  return (
    <Panel title="Sessions">
      {sessions.isError ? <ErrorText error={sessions.error} /> : null}
      {sessions.isSuccess && !sessions.data.sessions.length ? <EmptyState>No sessions</EmptyState> : null}
      {sessions.isSuccess && sessions.data.sessions.length ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left font-mono text-[10px] font-medium uppercase tracking-wider text-[var(--fg-muted)]">
                <th className="py-2 pr-3">ID</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2">Provider</th>
                <th className="px-3 py-2">Model</th>
                <th className="py-2 pl-3">CWD</th>
              </tr>
            </thead>
            <tbody>
              {sessions.data.sessions.map((session) => (
                <tr key={session.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="py-3 pr-3 font-semibold text-[var(--fg)]">{session.id}</td>
                  <td className="px-3 py-3"><StatusBadge>{session.state || "unknown"}</StatusBadge></td>
                  <td className="px-3 py-3 font-mono text-xs text-[var(--fg-soft)]">{session.config?.provider || ""}</td>
                  <td className="px-3 py-3 font-mono text-xs text-[var(--fg-soft)]">{session.config?.model || ""}</td>
                  <td className="max-w-[420px] break-all py-3 pl-3 font-mono text-xs text-[var(--fg-muted)]">{session.cwd || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Panel>
  );
}

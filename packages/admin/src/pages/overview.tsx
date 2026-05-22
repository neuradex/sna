import { ShieldCheck, Terminal } from "lucide-react";
import { EmptyState, ErrorText, Panel, StatusBadge } from "../components/ui";
import { useAuthRequestsQuery, useHealthQuery, useSessionsQuery } from "../queries";

export function OverviewPage() {
  const health = useHealthQuery();
  const authRequests = useAuthRequestsQuery();
  const sessions = useSessionsQuery();
  const pendingCount = authRequests.data?.requests.filter((request) => request.status === "pending").length ?? 0;

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Panel title="Server">
          {health.isError ? <ErrorText error={health.error} /> : (
            <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              <dt className="font-mono text-xs text-[var(--fg-muted)]">Name</dt>
              <dd className="font-medium text-[var(--fg)]">{health.data?.name ?? "sna"}</dd>
              <dt className="font-mono text-xs text-[var(--fg-muted)]">Version</dt>
              <dd className="font-medium text-[var(--fg)]">{health.data?.version ?? "unknown"}</dd>
              <dt className="font-mono text-xs text-[var(--fg-muted)]">URL</dt>
              <dd className="break-all font-medium text-[var(--fg)]">{location.origin}</dd>
            </dl>
          )}
        </Panel>

        <Panel title="Activity">
          {authRequests.isError || sessions.isError ? <EmptyState>Admin session unavailable.</EmptyState> : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Metric icon={<ShieldCheck size={18} />} label="Pending authorizations" value={pendingCount} tone={pendingCount ? "warn" : "good"} />
              <Metric icon={<Terminal size={18} />} label="Sessions" value={sessions.data?.sessions.length ?? 0} tone="neutral" />
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "neutral" | "good" | "warn";
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-subtle)] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[var(--accent)]">{icon}</div>
        <StatusBadge tone={tone}>{value}</StatusBadge>
      </div>
      <div className="text-sm font-semibold text-[var(--fg)]">{label}</div>
    </div>
  );
}

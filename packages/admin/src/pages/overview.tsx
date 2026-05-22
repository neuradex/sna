import { ShieldCheck, Terminal } from "lucide-react";
import { ConnectionPanel } from "../components/connection-panel";
import { EmptyState, ErrorText, Panel, StatusBadge } from "../components/ui";
import { useAuthToken } from "../auth-token";
import { useAuthRequestsQuery, useHealthQuery, useSessionsQuery } from "../queries";

export function OverviewPage() {
  const { token } = useAuthToken();
  const health = useHealthQuery();
  const authRequests = useAuthRequestsQuery();
  const sessions = useSessionsQuery();
  const pendingCount = authRequests.data?.requests.filter((request) => request.status === "pending").length ?? 0;

  return (
    <div className="grid gap-4">
      <ConnectionPanel />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Panel title="Server">
          {health.isError ? <ErrorText error={health.error} /> : (
            <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              <dt className="text-stone-500">Name</dt>
              <dd className="font-medium text-stone-950">{health.data?.name ?? "sna"}</dd>
              <dt className="text-stone-500">Version</dt>
              <dd className="font-medium text-stone-950">{health.data?.version ?? "unknown"}</dd>
              <dt className="text-stone-500">URL</dt>
              <dd className="break-all font-medium text-stone-950">{location.origin}</dd>
            </dl>
          )}
        </Panel>

        <Panel title="Activity">
          {!token ? <EmptyState>Enter an auth token to load daemon activity.</EmptyState> : (
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
    <div className="rounded-md border border-stone-200 bg-stone-50 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-stone-600">{icon}</div>
        <StatusBadge tone={tone}>{value}</StatusBadge>
      </div>
      <div className="text-sm font-semibold text-stone-900">{label}</div>
    </div>
  );
}

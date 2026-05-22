import { Check, X } from "lucide-react";
import { Button } from "../components/button";
import { EmptyState, ErrorText, Panel, StatusBadge, TableSkeleton } from "../components/ui";
import { canActOnAuthRequest, authRequestLabel, statusTone, type AuthRequest } from "../features/auth-requests";
import { useAuthRequestAction, useAuthRequestsQuery } from "../queries";

export function AuthorizationPage() {
  const requests = useAuthRequestsQuery();
  const action = useAuthRequestAction();
  const focusedRequestId = new URLSearchParams(location.search).get("request");
  const loading = !requests.isError && !requests.data && (requests.isLoading || requests.isFetching);

  return (
    <Panel title="Authorization Requests">
      {requests.isError ? <ErrorText error={requests.error} /> : null}
      {loading ? <TableSkeleton columns={4} rows={3} /> : null}
      {requests.isSuccess && !requests.data.requests.length ? <EmptyState>No authorization requests</EmptyState> : null}
      {requests.isSuccess && requests.data.requests.length ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left font-mono text-[10px] font-medium uppercase tracking-wider text-[var(--fg-muted)]">
                <th className="py-2 pr-3">Client</th>
                <th className="px-3 py-2">Scopes</th>
                <th className="px-3 py-2">State</th>
                <th className="py-2 pl-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {requests.data.requests.map((request) => (
                <AuthRequestRow
                  key={request.requestId}
                  request={request}
                  focused={focusedRequestId === request.requestId}
                  busy={action.isPending && action.variables?.requestId === request.requestId}
                  error={action.variables?.requestId === request.requestId ? action.error : null}
                  onAction={(nextAction) => action.mutate({ requestId: request.requestId, action: nextAction })}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Panel>
  );
}

function AuthRequestRow({
  request,
  focused,
  busy,
  error,
  onAction,
}: {
  request: AuthRequest;
  focused: boolean;
  busy: boolean;
  error: unknown;
  onAction: (action: "approve" | "deny") => void;
}) {
  const canAct = canActOnAuthRequest(request);
  return (
    <tr className={`border-b border-[var(--border)] last:border-0 ${focused ? "bg-[var(--accent-soft)]" : ""}`}>
      <td className="max-w-[320px] py-3 pr-3">
        <div className="font-semibold text-[var(--fg)]">{authRequestLabel(request)}</div>
        <div className="break-all font-mono text-[10px] text-[var(--fg-muted)]">{request.clientId}</div>
        {error ? <div className="mt-2 font-mono text-[10px] font-medium text-[var(--bad)]">{error instanceof Error ? error.message : String(error)}</div> : null}
      </td>
      <td className="px-3 py-3 font-mono text-xs text-[var(--fg-soft)]">{request.scopes.join(", ") || "none"}</td>
      <td className="px-3 py-3">
        <StatusBadge tone={statusTone(request.status)}>{request.status}</StatusBadge>
      </td>
      <td className="py-3 pl-3">
        <div className="flex justify-end gap-2">
          {canAct ? (
            <>
              <Button
                className="focus-ring inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 font-mono text-xs font-medium text-[var(--accent)] transition hover:border-[var(--accent)]"
                type="button"
                disabled={busy}
                onClick={() => onAction("approve")}
              >
                <Check size={15} />
                Approve
              </Button>
              <Button
                className="focus-ring inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-subtle)] px-3 font-mono text-xs font-medium text-[var(--fg-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--fg-soft)]"
                type="button"
                disabled={busy}
                onClick={() => onAction("deny")}
              >
                <X size={15} />
                Deny
              </Button>
            </>
          ) : <span className="font-mono text-xs text-[var(--fg-faint)]">Handled</span>}
        </div>
      </td>
    </tr>
  );
}

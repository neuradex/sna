import { Check, X } from "lucide-react";
import { EmptyState, ErrorText, Panel, StatusBadge } from "../components/ui";
import { canActOnAuthRequest, authRequestLabel, statusTone, type AuthRequest } from "../features/auth-requests";
import { useAuthToken } from "../auth-token";
import { useAuthRequestAction, useAuthRequestsQuery } from "../queries";

export function AuthorizationPage() {
  const { token } = useAuthToken();
  const requests = useAuthRequestsQuery();
  const action = useAuthRequestAction();
  const focusedRequestId = new URLSearchParams(location.search).get("request");

  return (
    <Panel title="Authorization Requests">
      {!token ? <EmptyState>Enter an auth token to manage authorization requests.</EmptyState> : null}
      {token && requests.isError ? <ErrorText error={requests.error} /> : null}
      {token && requests.isSuccess && !requests.data.requests.length ? <EmptyState>No authorization requests</EmptyState> : null}
      {token && requests.isSuccess && requests.data.requests.length ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs font-semibold uppercase tracking-normal text-stone-500">
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
    <tr className={`border-b border-stone-100 last:border-0 ${focused ? "bg-amber-50" : ""}`}>
      <td className="max-w-[320px] py-3 pr-3">
        <div className="font-semibold text-stone-950">{authRequestLabel(request)}</div>
        <div className="break-all text-xs text-stone-500">{request.clientId}</div>
        {error ? <div className="mt-2 text-xs font-medium text-red-700">{error instanceof Error ? error.message : String(error)}</div> : null}
      </td>
      <td className="px-3 py-3 text-stone-700">{request.scopes.join(", ") || "none"}</td>
      <td className="px-3 py-3">
        <StatusBadge tone={statusTone(request.status)}>{request.status}</StatusBadge>
      </td>
      <td className="py-3 pl-3">
        <div className="flex justify-end gap-2">
          {canAct ? (
            <>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md bg-stone-950 px-3 text-sm font-semibold text-white"
                type="button"
                disabled={busy}
                onClick={() => onAction("approve")}
              >
                <Check size={15} />
                Approve
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-900"
                type="button"
                disabled={busy}
                onClick={() => onAction("deny")}
              >
                <X size={15} />
                Deny
              </button>
            </>
          ) : <span className="text-sm text-stone-400">Handled</span>}
        </div>
      </td>
    </tr>
  );
}

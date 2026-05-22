import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, type AuthRequestsResponse, type HealthResponse, type SessionsResponse } from "./api";
import { useAuthToken } from "./auth-token";

export const queryKeys = {
  health: ["health"] as const,
  authRequests: ["auth-requests"] as const,
  sessions: ["sessions"] as const,
};

export function useHealthQuery() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: () => apiRequest<HealthResponse>("/health"),
    refetchInterval: 5_000,
  });
}

export function useAuthRequestsQuery() {
  const { token } = useAuthToken();
  return useQuery({
    queryKey: queryKeys.authRequests,
    queryFn: () => apiRequest<AuthRequestsResponse>("/auth/pkce/requests", { token }),
    enabled: Boolean(token),
    refetchInterval: 3_000,
  });
}

export function useSessionsQuery() {
  const { token } = useAuthToken();
  return useQuery({
    queryKey: queryKeys.sessions,
    queryFn: () => apiRequest<SessionsResponse>("/agent/sessions", { token }),
    enabled: Boolean(token),
    refetchInterval: 3_000,
  });
}

export function useAuthRequestAction() {
  const { token } = useAuthToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, action }: { requestId: string; action: "approve" | "deny" }) =>
      apiRequest(`/auth/pkce/requests/${encodeURIComponent(requestId)}/${action}`, {
        method: "POST",
        token,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.authRequests }),
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
      ]);
    },
  });
}

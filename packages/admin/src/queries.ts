import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiRequest,
  type AgentAuditResponse,
  type AuthRequestsResponse,
  type DifficultyLevel,
  type HealthResponse,
  type ProfilesResponse,
  type RegisteredRuntime,
  type RuntimeLaunchConfig,
  type RuntimesResponse,
  type SessionsResponse,
} from "./api";
import { useAuthToken } from "./auth-token";

export const queryKeys = {
  health: ["health"] as const,
  authRequests: ["auth-requests"] as const,
  sessions: ["sessions"] as const,
  runtimeProfiles: ["runtime-profiles"] as const,
  registeredRuntimes: ["registered-runtimes"] as const,
  agentAudit: ["agent-audit"] as const,
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

export function useRuntimeProfilesQuery() {
  const { token } = useAuthToken();
  return useQuery({
    queryKey: queryKeys.runtimeProfiles,
    queryFn: () => apiRequest<ProfilesResponse>("/agent/profiles", { token }),
    enabled: Boolean(token),
    refetchInterval: 5_000,
  });
}

export function useRegisteredRuntimesQuery() {
  const { token } = useAuthToken();
  return useQuery({
    queryKey: queryKeys.registeredRuntimes,
    queryFn: () => apiRequest<RuntimesResponse>("/agent/runtimes", { token }),
    enabled: Boolean(token),
    refetchInterval: 5_000,
  });
}

export function useAgentAuditQuery() {
  const { token } = useAuthToken();
  return useQuery({
    queryKey: queryKeys.agentAudit,
    queryFn: () => apiRequest<AgentAuditResponse>("/agent/audit", { token }),
    enabled: Boolean(token),
    refetchInterval: 5_000,
  });
}

export function useRuntimeProfileMutation() {
  const { token } = useAuthToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ level, input }: {
      level: DifficultyLevel;
      input: {
        label?: string;
        description?: string;
        runtimeId?: string;
        config?: RuntimeLaunchConfig;
      };
    }) => apiRequest(`/agent/profiles/${level}`, {
      method: "PUT",
      token,
      body: input,
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.runtimeProfiles }),
        queryClient.invalidateQueries({ queryKey: queryKeys.agentAudit }),
      ]);
    },
  });
}

export function useRegisterRuntimeMutation() {
  const { token } = useAuthToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: {
      id: string;
      input: {
        provider: string;
        label?: string;
        enabled?: boolean;
        modelProvider?: string;
        defaultModel?: string;
        cliPath?: string;
        models?: RegisteredRuntime["models"];
        config?: RuntimeLaunchConfig;
      };
    }) => apiRequest(`/agent/runtimes/${encodeURIComponent(id)}`, {
      method: "PUT",
      token,
      body: input,
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.registeredRuntimes }),
        queryClient.invalidateQueries({ queryKey: queryKeys.runtimeProfiles }),
        queryClient.invalidateQueries({ queryKey: queryKeys.agentAudit }),
      ]);
    },
  });
}

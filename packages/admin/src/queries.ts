import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiRequest,
  type AgentAuditResponse,
  type AuthRequestsResponse,
  type DifficultyLevel,
  type HealthResponse,
  type ListModelsResponse,
  type ModelPreset,
  type ModelPresetsResponse,
  type ProfilesResponse,
  type RegisteredRuntime,
  type RuntimeCatalogResponse,
  type RuntimeLaunchConfig,
  type RuntimesResponse,
  type SessionsResponse,
} from "./api";

export const queryKeys = {
  health: ["health"] as const,
  authRequests: ["auth-requests"] as const,
  sessions: ["sessions"] as const,
  runtimeCatalog: ["runtime-catalog"] as const,
  runtimeModels: (runtime: string, cliPath: string) => ["runtime-models", runtime, cliPath] as const,
  modelPresets: ["model-presets"] as const,
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
  return useQuery({
    queryKey: queryKeys.authRequests,
    queryFn: () => apiRequest<AuthRequestsResponse>("/auth/pkce/requests"),
    refetchInterval: 3_000,
  });
}

export function useSessionsQuery() {
  return useQuery({
    queryKey: queryKeys.sessions,
    queryFn: () => apiRequest<SessionsResponse>("/agent/sessions"),
    refetchInterval: 3_000,
  });
}

export function useAuthRequestAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, action }: { requestId: string; action: "approve" | "deny" }) =>
      apiRequest(`/auth/pkce/requests/${encodeURIComponent(requestId)}/${action}`, {
        method: "POST",
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
  return useQuery({
    queryKey: queryKeys.runtimeProfiles,
    queryFn: () => apiRequest<ProfilesResponse>("/agent/profiles"),
    refetchInterval: 5_000,
  });
}

export function useRuntimeCatalogQuery() {
  return useQuery({
    queryKey: queryKeys.runtimeCatalog,
    queryFn: () => apiRequest<RuntimeCatalogResponse>("/agent/runtime-catalog"),
    refetchInterval: 10_000,
  });
}

export function useRuntimeModelsQuery(runtime: string, cliPath = "", enabled = true) {
  return useQuery({
    queryKey: queryKeys.runtimeModels(runtime, cliPath),
    queryFn: () => apiRequest<ListModelsResponse>("/agent/list-models", {
      method: "POST",
      body: {
        runtime,
        ...(cliPath ? { config: { cliPath } } : {}),
      },
    }),
    enabled: enabled && Boolean(runtime),
    staleTime: 60_000,
  });
}

export function useModelPresetsQuery() {
  return useQuery({
    queryKey: queryKeys.modelPresets,
    queryFn: () => apiRequest<ModelPresetsResponse>("/agent/model-presets"),
    refetchInterval: 5_000,
  });
}

export function useRegisteredRuntimesQuery() {
  return useQuery({
    queryKey: queryKeys.registeredRuntimes,
    queryFn: () => apiRequest<RuntimesResponse>("/agent/runtimes"),
    refetchInterval: 5_000,
  });
}

export function useAgentAuditQuery() {
  return useQuery({
    queryKey: queryKeys.agentAudit,
    queryFn: () => apiRequest<AgentAuditResponse>("/agent/audit"),
    refetchInterval: 5_000,
  });
}

export function useRuntimeProfileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ level, input }: {
      level: DifficultyLevel;
      input: {
        label?: string;
        description?: string;
        runtimeId?: string | null;
        modelPresetId?: string | null;
        config?: RuntimeLaunchConfig;
      };
    }) => apiRequest(`/agent/profiles/${level}`, {
      method: "PUT",
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

export function useModelPresetMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: {
      id: string;
      input: {
        name?: string;
        runtimeId: string;
        model?: string;
        modelProvider?: string;
        reasoningLevel: number;
      };
    }) => apiRequest<{ status: "saved"; preset: ModelPreset }>(`/agent/model-presets/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: input,
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.modelPresets }),
        queryClient.invalidateQueries({ queryKey: queryKeys.runtimeProfiles }),
        queryClient.invalidateQueries({ queryKey: queryKeys.agentAudit }),
      ]);
    },
  });
}

export function useRegisterRuntimeMutation() {
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

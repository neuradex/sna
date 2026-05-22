import type { AuthRequest } from "./features/auth-requests";
import type { SnaSession } from "./features/sessions";

export interface HealthResponse {
  ok: boolean;
  name?: string;
  version?: string;
}

export interface AuthRequestsResponse {
  requests: AuthRequest[];
}

export interface SessionsResponse {
  sessions: SnaSession[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(
  path: string,
  options: { token?: string; method?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const res = await fetch(path, { method: options.method ?? "GET", headers });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Empty responses are allowed for a few operational endpoints.
  }
  if (!res.ok) {
    const message = typeof body === "object" && body && "message" in body
      ? String((body as { message?: unknown }).message)
      : `${res.status} ${res.statusText}`;
    throw new ApiError(message, res.status);
  }
  return body as T;
}

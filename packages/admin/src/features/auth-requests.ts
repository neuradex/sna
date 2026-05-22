export type AuthRequestStatus = "pending" | "approved" | "consumed" | "expired" | "denied";

export interface AuthRequest {
  requestId: string;
  clientId: string;
  displayName: string | null;
  redirectUri: string | null;
  scopes: string[];
  status: AuthRequestStatus;
  createdAt: number;
  expiresAt: number;
  approvedAt: number | null;
}

export function canActOnAuthRequest(request: Pick<AuthRequest, "status">): boolean {
  return request.status === "pending";
}

export function authRequestLabel(request: Pick<AuthRequest, "displayName" | "clientId">): string {
  return request.displayName?.trim() || request.clientId;
}

export function statusTone(status: AuthRequestStatus): "neutral" | "good" | "warn" | "bad" {
  if (status === "approved" || status === "consumed") return "good";
  if (status === "pending") return "warn";
  if (status === "denied" || status === "expired") return "bad";
  return "neutral";
}

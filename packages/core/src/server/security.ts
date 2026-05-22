import { randomBytes, timingSafeEqual } from "node:crypto";
import { validateAccessToken, type SnaClientTokenIdentity } from "./auth.js";

export interface SnaSecurityOptions {
  authToken?: string;
  adminToken?: string;
  allowedOrigins?: string[];
  unsafeDisableAuth?: boolean;
}

export interface ResolvedSnaSecurityOptions {
  authToken?: string;
  adminToken: string;
  allowedOrigins: string[];
  unsafeDisableAuth: boolean;
}

export type SnaAuthIdentity =
  | { type: "owner" }
  | SnaClientTokenIdentity;

export type SnaScope = "sessions" | "agent" | "chat";

const ADMIN_COOKIE_NAME = "sna_admin";
const ADMIN_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;

export function generateSnaAuthToken(): string {
  return `sna_${randomBytes(32).toString("base64url")}`;
}

export function generateSnaAdminToken(): string {
  return `sna_admin_${randomBytes(32).toString("base64url")}`;
}

export function parseAllowedOrigins(value?: string): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function resolveSnaSecurityOptions(options: SnaSecurityOptions = {}): ResolvedSnaSecurityOptions {
  const unsafeDisableAuth = options.unsafeDisableAuth === true;
  const authToken = options.authToken?.trim() || process.env.SNA_AUTH_TOKEN?.trim();
  const adminToken = options.adminToken?.trim() || process.env.SNA_ADMIN_TOKEN?.trim() || generateSnaAdminToken();
  const allowedOrigins = options.allowedOrigins ?? parseAllowedOrigins(process.env.SNA_ALLOWED_ORIGINS);

  if (!unsafeDisableAuth && !authToken) {
    throw new Error("SNA auth token is required. Pass authToken, set SNA_AUTH_TOKEN, or explicitly set unsafeDisableAuth for isolated tests only.");
  }

  return { authToken, adminToken, allowedOrigins, unsafeDisableAuth };
}

export function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: string[],
  requestOrigin?: string,
): boolean {
  if (!origin) return true;
  if (requestOrigin && origin === requestOrigin) return true;
  return allowedOrigins.includes("*") || allowedOrigins.includes(origin);
}

export function isAuthorizedToken(candidate: string | undefined, expected: string | undefined): boolean {
  if (!candidate || !expected) return false;
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  if (candidateBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(candidateBytes, expectedBytes);
}

export function resolveSnaAuthIdentity(candidate: string | undefined, ownerToken: string | undefined): SnaAuthIdentity | undefined {
  if (isAuthorizedToken(candidate, ownerToken)) return { type: "owner" };
  if (!candidate) return undefined;
  return validateAccessToken(candidate);
}

export function identityHasScope(identity: SnaAuthIdentity | undefined, requiredScope: SnaScope | undefined): boolean {
  if (!requiredScope) return true;
  if (identity?.type === "owner") return true;
  if (identity?.type !== "client") return false;
  return identity.scopes.includes(requiredScope) || identity.scopes.includes("*");
}

export function requiredScopeForHttpRoute(_method: string, pathname: string): SnaScope | undefined {
  if (pathname === "/agent/sessions" || pathname.startsWith("/agent/sessions/")) return "sessions";
  if (pathname.startsWith("/agent/")) return "agent";
  if (pathname.startsWith("/chat/")) return "chat";
  return undefined;
}

export function requiredScopeForWsMessage(type: string): SnaScope | undefined {
  if (type.startsWith("sessions.")) return "sessions";
  if (type.startsWith("agent.") || type.startsWith("permission.")) return "agent";
  if (type.startsWith("chat.")) return "chat";
  return undefined;
}

export function extractBearerToken(
  authorization: string | undefined,
  headerToken?: string | undefined,
): string | undefined {
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }
  return headerToken?.trim() || undefined;
}

export function extractWsToken(
  headers: { authorization?: string; "x-sna-token"?: string },
  url: URL,
): string | undefined {
  return extractBearerToken(headers.authorization, headers["x-sna-token"]) ?? url.searchParams.get("token") ?? undefined;
}

export function rejectUpgrade(socket: { write(data: string): void; destroy(): void }, status: 401 | 403, message: string): void {
  socket.write(
    `HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : "Forbidden"}\r\n` +
    "Connection: close\r\n" +
    "Content-Type: text/plain; charset=utf-8\r\n" +
    `Content-Length: ${Buffer.byteLength(message)}\r\n` +
    "\r\n" +
    message,
  );
  socket.destroy();
}

function isPublicHttpRoute(method: string, pathname: string): boolean {
  if (method === "GET" && (pathname === "/health" || pathname === "/admin" || pathname.startsWith("/admin/"))) return true;
  if (method === "POST" && (pathname === "/auth/pkce/start" || pathname === "/auth/pkce/token")) return true;
  if (method === "GET" && pathname.startsWith("/auth/pkce/requests/")) return true;
  return false;
}

function isAdminShellRoute(method: string, pathname: string): boolean {
  if (method !== "GET") return false;
  if (pathname === "/admin") return true;
  return pathname.startsWith("/admin/") && !pathname.startsWith("/admin/assets/");
}

function serializeAdminCookie(token: string, secure: boolean): string {
  const parts = [
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${ADMIN_COOKIE_MAX_AGE_SECONDS}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey !== name) continue;
    try {
      return decodeURIComponent(rawValue.join("="));
    } catch {
      return rawValue.join("=");
    }
  }
  return undefined;
}

function resolveAdminCookieIdentity(
  cookieHeader: string | undefined,
  adminToken: string,
  origin: string | undefined,
  requestOrigin: string,
): SnaAuthIdentity | undefined {
  if (origin && origin !== requestOrigin) return undefined;
  const cookieToken = parseCookie(cookieHeader, ADMIN_COOKIE_NAME);
  return isAuthorizedToken(cookieToken, adminToken) ? { type: "owner" } : undefined;
}

function applyCorsHeaders(
  c: any,
  origin: string | undefined,
  allowedOrigins: string[],
  requestOrigin: string,
): void {
  if (origin && isOriginAllowed(origin, allowedOrigins, requestOrigin)) {
  c.header("Access-Control-Allow-Origin", origin);
    c.header("Vary", "Origin");
  }
  c.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-SNA-Token");
}

export function createHttpSecurityMiddleware(options: SnaSecurityOptions) {
  const security = resolveSnaSecurityOptions(options);

  return async (c: any, next: () => Promise<void>) => {
    const method = c.req.method;
    const requestUrl = new URL(c.req.url);
    const pathname = requestUrl.pathname;
    const requestOrigin = requestUrl.origin;
    const origin = c.req.header("origin");

    if (!security.unsafeDisableAuth && !isOriginAllowed(origin, security.allowedOrigins, requestOrigin)) {
      return c.json({ status: "error", message: "Origin not allowed" }, 403);
    }

    applyCorsHeaders(c, origin, security.allowedOrigins, requestOrigin);
    if (!security.unsafeDisableAuth && isAdminShellRoute(method, pathname)) {
      c.header("Set-Cookie", serializeAdminCookie(security.adminToken, requestUrl.protocol === "https:"));
    }

    if (method === "OPTIONS") {
      return c.body(null, 204);
    }

    if (security.unsafeDisableAuth) {
      c.set?.("snaAuth", { type: "owner" });
      return next();
    }

    if (isPublicHttpRoute(method, pathname)) {
      return next();
    }

    const token = extractBearerToken(c.req.header("authorization"), c.req.header("x-sna-token"));
    const identity = resolveSnaAuthIdentity(token, security.authToken)
      ?? resolveAdminCookieIdentity(c.req.header("cookie"), security.adminToken, origin, requestOrigin);
    if (!identity) {
      return c.json({ status: "error", message: "Unauthorized" }, 401);
    }
    const requiredScope = requiredScopeForHttpRoute(method, pathname);
    if (!identityHasScope(identity, requiredScope)) {
      return c.json({ status: "error", message: `Insufficient scope: ${requiredScope} required` }, 403);
    }
    c.set?.("snaAuth", identity);

    return next();
  };
}

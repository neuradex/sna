import { randomBytes, timingSafeEqual } from "node:crypto";

export interface SnaSecurityOptions {
  authToken?: string;
  allowedOrigins?: string[];
  unsafeDisableAuth?: boolean;
}

export interface ResolvedSnaSecurityOptions {
  authToken?: string;
  allowedOrigins: string[];
  unsafeDisableAuth: boolean;
}

export function generateSnaAuthToken(): string {
  return `sna_${randomBytes(32).toString("base64url")}`;
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
  const allowedOrigins = options.allowedOrigins ?? parseAllowedOrigins(process.env.SNA_ALLOWED_ORIGINS);

  if (!unsafeDisableAuth && !authToken) {
    throw new Error("SNA auth token is required. Pass authToken, set SNA_AUTH_TOKEN, or explicitly set unsafeDisableAuth for isolated tests only.");
  }

  return { authToken, allowedOrigins, unsafeDisableAuth };
}

export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return true;
  return allowedOrigins.includes("*") || allowedOrigins.includes(origin);
}

export function isAuthorizedToken(candidate: string | undefined, expected: string | undefined): boolean {
  if (!candidate || !expected) return false;
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  if (candidateBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(candidateBytes, expectedBytes);
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
  return method === "GET" && pathname === "/health";
}

function applyCorsHeaders(c: any, origin: string | undefined, allowedOrigins: string[]): void {
  if (origin && isOriginAllowed(origin, allowedOrigins)) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Vary", "Origin");
  }
  c.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-SNA-Token");
}

export function createHttpSecurityMiddleware(options: SnaSecurityOptions) {
  const security = resolveSnaSecurityOptions(options);

  return async (c: any, next: () => Promise<void>) => {
    const method = c.req.method;
    const pathname = new URL(c.req.url).pathname;
    const origin = c.req.header("origin");

    if (!security.unsafeDisableAuth && !isOriginAllowed(origin, security.allowedOrigins)) {
      return c.json({ status: "error", message: "Origin not allowed" }, 403);
    }

    applyCorsHeaders(c, origin, security.allowedOrigins);

    if (method === "OPTIONS") {
      return c.body(null, 204);
    }

    if (security.unsafeDisableAuth || isPublicHttpRoute(method, pathname)) {
      return next();
    }

    const token = extractBearerToken(c.req.header("authorization"), c.req.header("x-sna-token"));
    if (!isAuthorizedToken(token, security.authToken)) {
      return c.json({ status: "error", message: "Unauthorized" }, 401);
    }

    return next();
  };
}

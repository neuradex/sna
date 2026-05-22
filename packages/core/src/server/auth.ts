import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb } from "../db/schema.js";

const GRANT_TTL_MS = 10 * 60 * 1000;
const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface PkceStartInput {
  clientId: string;
  displayName?: string;
  redirectUri?: string;
  codeChallenge: string;
  codeChallengeMethod?: "S256";
  scopes?: string[];
}

export interface PkceRequestInfo {
  requestId: string;
  clientId: string;
  displayName: string | null;
  redirectUri: string | null;
  scopes: string[];
  status: "pending" | "approved" | "consumed" | "expired" | "denied";
  code?: string;
  createdAt: number;
  expiresAt: number;
  approvedAt: number | null;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  refreshExpiresIn: number;
  scopes: string[];
}

export interface SnaClientTokenIdentity {
  type: "client";
  clientId: string;
  displayName: string | null;
  scopes: string[];
}

interface PkceRequestRow {
  id: string;
  client_id: string;
  display_name: string | null;
  redirect_uri: string | null;
  scopes: string;
  code_challenge: string;
  code_challenge_method: string;
  status: string;
  code: string | null;
  created_at: number;
  expires_at: number;
  approved_at: number | null;
}

interface AuthTokenRow {
  refresh_token_hash: string;
  access_token_hash: string;
  client_id: string;
  display_name: string | null;
  scopes: string;
  access_expires_at: number;
  refresh_expires_at: number;
  revoked_at: number | null;
}

export function createPkceRequest(input: PkceStartInput): PkceRequestInfo {
  const clientId = requireNonEmpty(input.clientId, "clientId is required");
  const codeChallenge = requireNonEmpty(input.codeChallenge, "codeChallenge is required");
  const method = input.codeChallengeMethod ?? "S256";
  if (method !== "S256") throw new Error("Only S256 PKCE code challenges are supported");

  const now = Date.now();
  const request: PkceRequestInfo = {
    requestId: `authreq_${randomSecret()}`,
    clientId,
    displayName: input.displayName?.trim() || null,
    redirectUri: input.redirectUri?.trim() || null,
    scopes: normalizeScopes(input.scopes),
    status: "pending",
    createdAt: now,
    expiresAt: now + GRANT_TTL_MS,
    approvedAt: null,
  };

  getDb().prepare(`
    INSERT INTO auth_pkce_requests
      (id, client_id, display_name, redirect_uri, scopes, code_challenge, code_challenge_method, status, code, created_at, expires_at, approved_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, NULL)
  `).run(
    request.requestId,
    clientId,
    request.displayName,
    request.redirectUri,
    JSON.stringify(request.scopes),
    codeChallenge,
    method,
    request.createdAt,
    request.expiresAt,
  );

  return request;
}

export function listPkceRequests(): PkceRequestInfo[] {
  expireStaleRequests();
  const rows = getDb().prepare(`
    SELECT * FROM auth_pkce_requests
    WHERE status IN ('pending', 'approved')
    ORDER BY created_at DESC
  `).all() as PkceRequestRow[];
  return rows.map(rowToRequestInfo);
}

export function getPkceRequest(requestId: string): PkceRequestInfo | null {
  expireStaleRequests();
  const row = getDb().prepare("SELECT * FROM auth_pkce_requests WHERE id = ?").get(requestId) as PkceRequestRow | undefined;
  return row ? rowToRequestInfo(row) : null;
}

export function approvePkceRequest(requestId: string): PkceRequestInfo {
  expireStaleRequests();
  const db = getDb();
  const row = db.prepare("SELECT * FROM auth_pkce_requests WHERE id = ?").get(requestId) as PkceRequestRow | undefined;
  if (!row) throw new Error("Authorization request not found");
  if (row.status !== "pending") throw new Error(`Authorization request is ${row.status}`);
  if (row.expires_at <= Date.now()) throw new Error("Authorization request expired");

  const code = `authcode_${randomSecret()}`;
  const approvedAt = Date.now();
  db.prepare(`
    UPDATE auth_pkce_requests
    SET status = 'approved', code = ?, approved_at = ?
    WHERE id = ?
  `).run(code, approvedAt, requestId);

  return getPkceRequest(requestId)!;
}

export function denyPkceRequest(requestId: string): PkceRequestInfo {
  expireStaleRequests();
  const db = getDb();
  const row = db.prepare("SELECT * FROM auth_pkce_requests WHERE id = ?").get(requestId) as PkceRequestRow | undefined;
  if (!row) throw new Error("Authorization request not found");
  if (row.status !== "pending") throw new Error(`Authorization request is ${row.status}`);
  db.prepare("UPDATE auth_pkce_requests SET status = 'denied', code = NULL WHERE id = ?").run(requestId);
  return getPkceRequest(requestId)!;
}

export function exchangeAuthorizationCode(input: {
  requestId: string;
  code: string;
  codeVerifier: string;
}): TokenResponse {
  expireStaleRequests();
  const db = getDb();
  const row = db.prepare("SELECT * FROM auth_pkce_requests WHERE id = ?").get(input.requestId) as PkceRequestRow | undefined;
  if (!row) throw new Error("Authorization request not found");
  if (row.status !== "approved" || !row.code) throw new Error(`Authorization request is ${row.status}`);
  if (row.expires_at <= Date.now()) throw new Error("Authorization request expired");
  if (!constantEqual(input.code, row.code)) throw new Error("Authorization code is invalid");
  if (!verifyPkce(input.codeVerifier, row.code_challenge)) throw new Error("PKCE verifier is invalid");

  const tokens = issueTokens({
    clientId: row.client_id,
    displayName: row.display_name,
    scopes: parseScopes(row.scopes),
  });
  db.prepare("UPDATE auth_pkce_requests SET status = 'consumed', code = NULL WHERE id = ?").run(row.id);
  return tokens;
}

export function refreshAccessToken(refreshToken: string): TokenResponse {
  const db = getDb();
  const now = Date.now();
  const refreshHash = hashSecret(refreshToken);
  const row = db.prepare(`
    SELECT * FROM auth_tokens
    WHERE refresh_token_hash = ?
      AND revoked_at IS NULL
      AND refresh_expires_at > ?
  `).get(refreshHash, now) as AuthTokenRow | undefined;
  if (!row) throw new Error("Refresh token is invalid or expired");

  const accessToken = `sna_at_${randomSecret()}`;
  const accessExpiresAt = now + ACCESS_TTL_MS;
  db.prepare(`
    UPDATE auth_tokens
    SET access_token_hash = ?, access_expires_at = ?, last_used_at = ?
    WHERE refresh_token_hash = ?
  `).run(hashSecret(accessToken), accessExpiresAt, now, refreshHash);

  return {
    accessToken,
    refreshToken,
    tokenType: "Bearer",
    expiresIn: Math.floor((accessExpiresAt - now) / 1000),
    refreshExpiresIn: Math.floor((row.refresh_expires_at - now) / 1000),
    scopes: parseScopes(row.scopes),
  };
}

export function validateAccessToken(accessToken: string): SnaClientTokenIdentity | undefined {
  if (!accessToken.startsWith("sna_at_")) return undefined;
  try {
    const db = getDb();
    const now = Date.now();
    const row = db.prepare(`
      SELECT * FROM auth_tokens
      WHERE access_token_hash = ?
        AND revoked_at IS NULL
        AND access_expires_at > ?
    `).get(hashSecret(accessToken), now) as AuthTokenRow | undefined;
    if (!row) return undefined;
    db.prepare("UPDATE auth_tokens SET last_used_at = ? WHERE access_token_hash = ?").run(now, row.access_token_hash);
    return {
      type: "client",
      clientId: row.client_id,
      displayName: row.display_name,
      scopes: parseScopes(row.scopes),
    };
  } catch {
    return undefined;
  }
}

export function revokeToken(token: string): boolean {
  const hash = hashSecret(token);
  const result = getDb().prepare(`
    UPDATE auth_tokens
    SET revoked_at = ?
    WHERE revoked_at IS NULL
      AND (access_token_hash = ? OR refresh_token_hash = ?)
  `).run(Date.now(), hash, hash);
  return result.changes > 0;
}

function issueTokens(input: { clientId: string; displayName: string | null; scopes: string[] }): TokenResponse {
  const now = Date.now();
  const accessToken = `sna_at_${randomSecret()}`;
  const refreshToken = `sna_rt_${randomSecret()}`;
  const accessExpiresAt = now + ACCESS_TTL_MS;
  const refreshExpiresAt = now + REFRESH_TTL_MS;
  getDb().prepare(`
    INSERT INTO auth_tokens
      (id, refresh_token_hash, access_token_hash, client_id, display_name, scopes, created_at, last_used_at, access_expires_at, refresh_expires_at, revoked_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `).run(
    `authtok_${randomSecret()}`,
    hashSecret(refreshToken),
    hashSecret(accessToken),
    input.clientId,
    input.displayName,
    JSON.stringify(input.scopes),
    now,
    now,
    accessExpiresAt,
    refreshExpiresAt,
  );
  return {
    accessToken,
    refreshToken,
    tokenType: "Bearer",
    expiresIn: Math.floor((accessExpiresAt - now) / 1000),
    refreshExpiresIn: Math.floor((refreshExpiresAt - now) / 1000),
    scopes: input.scopes,
  };
}

function expireStaleRequests(): void {
  getDb().prepare(`
    UPDATE auth_pkce_requests
    SET status = 'expired', code = NULL
    WHERE expires_at <= ?
      AND status IN ('pending', 'approved')
  `).run(Date.now());
}

function rowToRequestInfo(row: PkceRequestRow): PkceRequestInfo {
  return {
    requestId: row.id,
    clientId: row.client_id,
    displayName: row.display_name,
    redirectUri: row.redirect_uri,
    scopes: parseScopes(row.scopes),
    status: row.status as PkceRequestInfo["status"],
    ...(row.status === "approved" && row.code ? { code: row.code } : {}),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    approvedAt: row.approved_at,
  };
}

function normalizeScopes(scopes: string[] | undefined): string[] {
  const normalized = new Set<string>();
  for (const scope of scopes ?? ["agent"]) {
    const value = scope.trim();
    if (value) normalized.add(value);
  }
  return [...normalized].sort();
}

function parseScopes(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function verifyPkce(verifier: string, challenge: string): boolean {
  return constantEqual(base64url(createHash("sha256").update(verifier).digest()), challenge);
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function randomSecret(): string {
  return randomBytes(32).toString("base64url");
}

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function constantEqual(a: string, b: string): boolean {
  const aBytes = Buffer.from(a);
  const bBytes = Buffer.from(b);
  if (aBytes.length !== bBytes.length) return false;
  return timingSafeEqual(aBytes, bBytes);
}

function requireNonEmpty(value: string | undefined, message: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(message);
  return trimmed;
}

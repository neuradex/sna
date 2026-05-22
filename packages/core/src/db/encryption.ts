import { randomBytes, createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

export type DbKeyProvider =
  | { type: "raw"; key: string }
  | { type: "env"; env?: string }
  | { type: "keytar"; service?: string; account?: string }
  | { type: "custom"; getKey(): string | Promise<string> };

export interface EncryptedDatabaseOptions {
  encryption?: "none" | "sqlite-cipher";
  cipher?: "sqlcipher" | "aes256cbc" | "chacha20";
  keyProvider?: DbKeyProvider;
}

export interface DatabaseKeyResolutionOptions {
  keytar?: KeytarLike;
}

interface KeytarLike {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
}

const DEFAULT_KEYTAR_SERVICE = "dev.neuradex.sna";
const DEFAULT_ENV_KEY = "SNA_DB_KEY";

export async function resolveDatabaseKey(
  options: EncryptedDatabaseOptions | undefined,
  dbPath: string,
  resolutionOptions: DatabaseKeyResolutionOptions = {},
): Promise<string | undefined> {
  if (!options || options.encryption === undefined || options.encryption === "none") {
    return undefined;
  }
  if (options.encryption !== "sqlite-cipher") {
    throw new Error(`Unsupported database encryption mode: ${String(options.encryption)}`);
  }

  const provider = options.keyProvider ?? { type: "keytar" as const };
  switch (provider.type) {
    case "raw":
      return requireNonEmpty(provider.key, "raw database encryption key is empty");
    case "env": {
      const envName = provider.env ?? DEFAULT_ENV_KEY;
      return requireNonEmpty(process.env[envName], `database encryption key env var ${envName} is not set`);
    }
    case "keytar":
      return resolveKeytarKey(provider, dbPath, resolutionOptions.keytar);
    case "custom":
      return requireNonEmpty(await provider.getKey(), "custom database encryption key is empty");
  }
}

function requireNonEmpty(value: string | undefined, message: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(message);
  return trimmed;
}

async function resolveKeytarKey(
  provider: Extract<DbKeyProvider, { type: "keytar" }>,
  dbPath: string,
  injectedKeytar?: KeytarLike,
): Promise<string> {
  const keytar = injectedKeytar ?? loadKeytar();
  const service = provider.service ?? DEFAULT_KEYTAR_SERVICE;
  const account = provider.account ?? `db:${dbPathFingerprint(dbPath)}`;

  const existing = await keytar.getPassword(service, account);
  if (existing?.trim()) return existing;

  const generated = randomBytes(32).toString("base64url");
  await keytar.setPassword(service, account, generated);
  return generated;
}

function loadKeytar(): KeytarLike {
  try {
    const req = createRequire(import.meta.url);
    return req("keytar");
  } catch (err) {
    throw new Error(
      "keytar is required for database.keyProvider.type=\"keytar\". " +
      "Install keytar or use keyProvider.type=\"env\"/\"raw\".",
    );
  }
}

function dbPathFingerprint(dbPath: string): string {
  let resolved = path.resolve(dbPath);
  try {
    resolved = fs.realpathSync.native(path.dirname(resolved)) + path.sep + path.basename(resolved);
  } catch {
    // Directory may not exist yet. The absolute path is still stable enough.
  }
  return createHash("sha256").update(resolved).digest("hex").slice(0, 24);
}

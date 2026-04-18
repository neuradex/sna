/**
 * Image/file storage — persists base64-encoded attachments to disk under
 * `dataDir/images/{sessionId}/{sha256_prefix}.{ext}` and returns canonical
 * EmbedRecord entries for session-manager to stash in `chat_messages.embeds`.
 *
 * Filenames are content-hashed so identical uploads dedup at the filesystem
 * level automatically. The embed id used in inline refs (`![](embed://<id>)`)
 * is the hash prefix — so referencing the same file twice writes the same id.
 *
 * Retrieve via HTTP: GET /chat/images/:sessionId/:filename
 */

import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { getConfig } from "../config.js";
import type { EmbedRecord } from "../history/types.js";

function getImageDir(): string {
  return path.join(getConfig().dataDir, "images");
}

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
};

export interface SavedEmbed {
  /** Short id used in inline refs: `![](embed://<id>)`. */
  id: string;
  /** Canonical embed record — what goes into the row's `embeds` JSON. */
  record: EmbedRecord;
}

/**
 * Save base64 attachments to disk. Returns {id, record} per input, in order.
 * Callers typically embed the id into content text via formatEmbedRef() and
 * merge records into the chat_messages row's embeds column.
 */
export function saveEmbeds(
  sessionId: string,
  attachments: Array<{ base64: string; mimeType: string }>,
): SavedEmbed[] {
  const dir = path.join(getImageDir(), sessionId);
  fs.mkdirSync(dir, { recursive: true });

  return attachments.map((att) => {
    const ext = MIME_TO_EXT[att.mimeType] ?? "bin";
    const id = createHash("sha256").update(att.base64).digest("hex").slice(0, 12);
    const filename = `${id}.${ext}`;
    const filePath = path.join(dir, filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, Buffer.from(att.base64, "base64"));
    }
    return {
      id,
      record: { mime_type: att.mimeType, path: filename },
    };
  });
}

/**
 * Resolve an attachment file path given a session + filename from a URL.
 * Returns null if missing or if traversal is attempted.
 */
export function resolveImagePath(sessionId: string, filename: string): string | null {
  if (filename.includes("..") || filename.includes("/")) return null;
  const filePath = path.join(getImageDir(), sessionId, filename);
  return fs.existsSync(filePath) ? filePath : null;
}

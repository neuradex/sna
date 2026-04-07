/**
 * Image storage — saves base64 images to disk and serves them.
 *
 * Storage path: data/images/{sessionId}/{hash}.{ext}
 * Retrieve via: GET /chat/images/:sessionId/:filename
 */

import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { getConfig } from "../config.js";

function getImageDir(): string {
  return path.join(getConfig().dataDir, "images");
}

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export interface SavedImage {
  filename: string;
  path: string;
}

/**
 * Save base64 images to disk. Returns filenames for meta storage.
 */
export function saveImages(
  sessionId: string,
  images: Array<{ base64: string; mimeType: string }>,
): string[] {
  const dir = path.join(getImageDir(), sessionId);
  fs.mkdirSync(dir, { recursive: true });

  return images.map((img) => {
    const ext = MIME_TO_EXT[img.mimeType] ?? "bin";
    const hash = createHash("sha256").update(img.base64).digest("hex").slice(0, 12);
    const filename = `${hash}.${ext}`;
    const filePath = path.join(dir, filename);

    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, Buffer.from(img.base64, "base64"));
    }

    return filename;
  });
}

/**
 * Resolve an image file path. Returns null if not found.
 */
export function resolveImagePath(sessionId: string, filename: string): string | null {
  // Prevent path traversal
  if (filename.includes("..") || filename.includes("/")) return null;
  const filePath = path.join(getImageDir(), sessionId, filename);
  return fs.existsSync(filePath) ? filePath : null;
}

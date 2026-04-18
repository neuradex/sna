import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { getConfig } from "../config.js";
function getImageDir() {
  return path.join(getConfig().dataDir, "images");
}
const MIME_TO_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "application/pdf": "pdf"
};
function saveEmbeds(sessionId, attachments) {
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
      record: { mime_type: att.mimeType, path: filename }
    };
  });
}
function resolveImagePath(sessionId, filename) {
  if (filename.includes("..") || filename.includes("/")) return null;
  const filePath = path.join(getImageDir(), sessionId, filename);
  return fs.existsSync(filePath) ? filePath : null;
}
export {
  resolveImagePath,
  saveEmbeds
};

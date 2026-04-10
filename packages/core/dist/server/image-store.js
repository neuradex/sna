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
  "image/svg+xml": "svg"
};
function saveImages(sessionId, images) {
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
function resolveImagePath(sessionId, filename) {
  if (filename.includes("..") || filename.includes("/")) return null;
  const filePath = path.join(getImageDir(), sessionId, filename);
  return fs.existsSync(filePath) ? filePath : null;
}
export {
  resolveImagePath,
  saveImages
};

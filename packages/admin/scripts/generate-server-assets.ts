import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientDir = path.join(packageRoot, "dist", "client");
const serverPath = path.join(packageRoot, "dist", "server.js");
const typesPath = path.join(packageRoot, "dist", "server.d.ts");

const html = fs.readFileSync(path.join(clientDir, "index.html"), "utf8");
const assets = collectAssets(clientDir);

fs.writeFileSync(serverPath, renderServerModule(html, assets));
fs.writeFileSync(typesPath, `export interface AdminAsset {
  content: Buffer;
  contentType: string;
}

export declare function renderAdminPage(): string;
export declare function getAdminAsset(pathname: string): AdminAsset | null;
export declare function listAdminAssetPaths(): string[];
`);

function collectAssets(root: string): Record<string, { content: string; contentType: string }> {
  const result: Record<string, { content: string; contentType: string }> = {};
  for (const filePath of walk(root)) {
    if (path.basename(filePath) === "index.html") continue;
    const relativePath = path.relative(root, filePath).split(path.sep).join("/");
    result[relativePath] = {
      content: fs.readFileSync(filePath).toString("base64"),
      contentType: contentTypeFor(filePath),
    };
  }
  return result;
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(filePath) : [filePath];
  });
}

function contentTypeFor(filePath: string): string {
  switch (path.extname(filePath)) {
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function renderServerModule(
  htmlContent: string,
  assetMap: Record<string, { content: string; contentType: string }>,
): string {
  return `const html = ${JSON.stringify(htmlContent)};
const assets = ${JSON.stringify(assetMap)};

export function renderAdminPage() {
  return html;
}

export function getAdminAsset(pathname) {
  const key = pathname.replace(/^\\/admin\\//, "").replace(/^\\/+/, "");
  const asset = assets[key];
  if (!asset) return null;
  return {
    content: Buffer.from(asset.content, "base64"),
    contentType: asset.contentType,
  };
}

export function listAdminAssetPaths() {
  return Object.keys(assets);
}
`;
}

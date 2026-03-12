import path from "path";
import { createRunHandler } from "sna/api/run";

const ROOT = process.cwd();
const TSX = path.join(ROOT, "node_modules/.bin/tsx");
const SNA_CORE = path.join(ROOT, "node_modules/sna");

export const runtime = "nodejs";

export const GET = createRunHandler({
  status: [TSX, path.join(SNA_CORE, "src/scripts/sna.ts"), "status"],
});

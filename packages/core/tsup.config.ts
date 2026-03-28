import { defineConfig } from "tsup";

export default defineConfig([
  // Main library — individual files
  {
    bundle: false,
    entry: ["src/**/*.ts", "!src/server/standalone.ts"],
    format: ["esm"],
    dts: true,
    outDir: "dist",
    external: [
      "hono",
      "hono/streaming",
      "hono/cors",
      "@hono/node-server",
      "better-sqlite3",
      "chalk",
      "js-yaml",
    ],
  },
  // Standalone server — bundled single file
  {
    bundle: true,
    entry: { "server/standalone": "src/server/standalone.ts" },
    format: ["esm"],
    dts: false,
    outDir: "dist",
    external: ["better-sqlite3"],
    esbuildOptions(options) {
      options.platform = "node";
    },
  },
]);

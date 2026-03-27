import { defineConfig } from "tsup";

export default defineConfig([
  // Main library — individual files, preserves "use client" directives
  {
    bundle: false,
    entry: ["src/**/*.ts", "src/**/*.tsx", "!src/server/standalone.ts"],
    format: ["esm"],
    dts: true,
    outDir: "dist",
    external: [
      // peer deps
      "react",
      "react-dom",
      "zustand",
      "zustand/middleware",
      // own deps (consumers install these via sna)
      "hono",
      "hono/streaming",
      "hono/cors",
      "@hono/node-server",
      "better-sqlite3",
      "chalk",
      "js-yaml",
    ],
    esbuildOptions(options) {
      options.jsx = "automatic";
    },
  },
  // Standalone server — bundled single file for `node dist/server/standalone.js`
  {
    bundle: true,
    entry: { "server/standalone": "src/server/standalone.ts" },
    format: ["esm"],
    dts: false,
    outDir: "dist",
    external: [
      // Node built-ins and native modules stay external
      "better-sqlite3",
    ],
    esbuildOptions(options) {
      options.platform = "node";
    },
  },
]);

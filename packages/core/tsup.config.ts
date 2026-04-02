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
      "ws",
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
  // Electron / Node.js launcher — bundled CJS for require() compat in main processes
  // shims: true injects import.meta.url polyfill so path resolution works in CJS
  {
    bundle: true,
    entry: {
      "electron/index": "src/electron/index.ts",
      "node/index": "src/node/index.ts",
    },
    format: ["cjs"],
    shims: true,
    dts: false,
    outDir: "dist",
    esbuildOptions(options) {
      options.platform = "node";
    },
  },
]);

import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    outDir: "dist",
    clean: true,
  },
  {
    entry: { "sna-test": "src/cli.ts" },
    format: ["esm"],
    dts: false,
    outDir: "dist",
    banner: { js: "#!/usr/bin/env node" },
  },
]);

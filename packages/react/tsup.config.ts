import { defineConfig } from "tsup";

export default defineConfig({
  bundle: false,
  entry: ["src/**/*.ts", "src/**/*.tsx"],
  format: ["esm"],
  dts: true,
  outDir: "dist",
  external: [
    // peer deps
    "react",
    "react-dom",
    "zustand",
    "zustand/middleware",
    // own deps
    "@sna-sdk/core",
    "marked",
  ],
  esbuildOptions(options) {
    options.jsx = "automatic";
  },
});

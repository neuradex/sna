import { defineConfig } from "tsup";

export default defineConfig({
  // bundle: false = 各ファイルを個別にトランスパイル
  // → "use client" ディレクティブがそのまま保たれる
  // → ファイル構造が dist/ に鏡像される
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
    "@xterm/xterm",
    "@xterm/addon-fit",
    "@xterm/addon-web-links",
    "@xterm/xterm/css/xterm.css",
    // own deps (consumers install these via sna)
    "hono",
    "hono/streaming",
    "better-sqlite3",
    "node-pty",
    "ws",
    "chalk",
    "js-yaml",
  ],
  esbuildOptions(options) {
    options.jsx = "automatic";
  },
});

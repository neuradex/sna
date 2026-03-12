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
    "next",
    "next/dynamic",
    "next/server",
    "zustand",
    "zustand/middleware",
    "@xterm/xterm",
    "@xterm/addon-fit",
    "@xterm/addon-web-links",
    "@xterm/xterm/css/xterm.css",
    // native deps (consumers install these)
    "better-sqlite3",
    "node-pty",
    "ws",
    "chalk",
  ],
  // .js 拡張子なしの相対 import を解決
  // (tsx が自動解決してたものを tsup でも通す)
  esbuildOptions(options) {
    options.jsx = "automatic";
  },
});

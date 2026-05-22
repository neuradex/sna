import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/admin/",
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 3098,
    proxy: {
      "/health": process.env.SNA_ADMIN_PROXY_TARGET ?? "http://127.0.0.1:3099",
      "/auth": process.env.SNA_ADMIN_PROXY_TARGET ?? "http://127.0.0.1:3099",
      "/agent": process.env.SNA_ADMIN_PROXY_TARGET ?? "http://127.0.0.1:3099",
      "/chat": process.env.SNA_ADMIN_PROXY_TARGET ?? "http://127.0.0.1:3099",
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    sourcemap: false,
  },
});

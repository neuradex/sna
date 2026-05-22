import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const proxyTarget = process.env.SNA_ADMIN_PROXY_TARGET ?? "http://127.0.0.1:3099";
const proxyToken = process.env.SNA_ADMIN_PROXY_TOKEN ?? process.env.SNA_AUTH_TOKEN;

function apiProxy() {
  return {
    target: proxyTarget,
    changeOrigin: true,
    configure(proxy: any) {
      proxy.on("proxyReq", (proxyReq: any) => {
        proxyReq.setHeader("Origin", proxyTarget);
        if (proxyToken) proxyReq.setHeader("Authorization", `Bearer ${proxyToken}`);
      });
    },
  };
}

export default defineConfig({
  base: "/admin/",
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 3098,
    proxy: {
      "/health": apiProxy(),
      "/auth": apiProxy(),
      "/agent": apiProxy(),
      "/chat": apiProxy(),
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    sourcemap: false,
  },
});

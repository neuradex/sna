import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "sna-port-api",
      configureServer(server) {
        server.middlewares.use("/api/sna-port", (_req, res) => {
          const portFile = path.join(process.cwd(), ".sna/sna-api.port");
          try {
            const port = fs.readFileSync(portFile, "utf8").trim();
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ port: Number(port) }));
          } catch {
            res.statusCode = 503;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ port: null, error: "SNA API not running" }));
          }
        });
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

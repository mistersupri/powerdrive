import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: { port: 5173, proxy: { "/api": { target: process.env.API_URL ?? "http://localhost:3000", changeOrigin: false } } },
  build: {
    target: "es2022", sourcemap: false, chunkSizeWarningLimit: 600,
  },
});

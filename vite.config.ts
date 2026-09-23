import { defineConfig } from "vite";

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "es2022",
    outDir: "ui-dist",
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: 0,
  },
});

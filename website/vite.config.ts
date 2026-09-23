import { defineConfig } from "vite";

// Product site, deployed to GitHub Pages by .github/workflows/pages.yml.
export default defineConfig({
  root: "website",
  // Relative so the site works both at the custom domain and at /trimbit/ on the user site.
  base: "./",
  publicDir: false,
  server: { port: 1430, strictPort: true, host: "127.0.0.1", fs: { allow: [".."] } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    assetsInlineLimit: 0,
  },
});

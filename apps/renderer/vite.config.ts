import path from "node:path";
import { fileURLToPath } from "node:url";

import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The shared renderer (@dashframe/app): route tree generated from its routes
// dir, `@` aliased to its src so the moved files' `@/...` imports resolve.
const appSrcDir = path.resolve(__dirname, "../../packages/app/src");
const appRoutesDir = path.resolve(appSrcDir, "routes");

// Phase 1 backend: same Dexie/IndexedDB store as web. @dashframe/core resolves
// its backend through the @dashframe/core-store stub, aliased to core-dexie.
const coreStorePath = path.resolve(
  __dirname,
  "../../packages/core-dexie/src/index.ts",
);

// DuckDB-WASM needs SharedArrayBuffer → cross-origin isolation (COOP/COEP). In
// the web app these come from its security-headers plugin; the renderer dev
// server needs them too. Packaged file:// isolation is set in the Electron main
// process (webPreferences / session.onHeadersReceived).
function coopCoepPlugin(): Plugin {
  return {
    name: "renderer-coop-coep",
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: appRoutesDir,
      generatedRouteTree: "./src/routeTree.gen.ts",
    }),
    react(),
    coopCoepPlugin(),
  ],
  resolve: {
    alias: {
      "@": appSrcDir,
      "@dashframe/core-store": coreStorePath,
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});

import path from "node:path";
import { fileURLToPath } from "node:url";

import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The shared renderer (@dashframe/app): route tree generated from its routes
// dir, `@` aliased to its src so the moved files' `@/...` imports resolve.
const appSrcDir = path.resolve(__dirname, "../../packages/app/src");
const appRoutesDir = path.resolve(appSrcDir, "routes");

export default defineConfig({
  plugins: lazyPlugins(() => [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: appRoutesDir,
      generatedRouteTree: "./src/routeTree.gen.ts",
    }),
    react(),
  ]),
  resolve: {
    alias: {
      "@": appSrcDir,
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

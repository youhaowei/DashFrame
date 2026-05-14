import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig, type Plugin } from "vite";

import { getSecurityHeaders } from "./lib/security-headers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DuckDB-WASM requires SharedArrayBuffer, which needs cross-origin isolation
// (COOP/COEP). Carries the CSP + security headers from the prior Next config
// across to Vite's dev + preview servers.
function securityHeadersPlugin(): Plugin {
  const headers = {
    ...Object.fromEntries(getSecurityHeaders().map((h) => [h.key, h.value])),
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
  };
  const apply = (res: { setHeader: (k: string, v: string) => void }) => {
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  };
  return {
    name: "dashframe-security-headers",
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        apply(res);
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((_req, res, next) => {
        apply(res);
        next();
      });
    },
  };
}

function getStorageBackendPath() {
  const storageImpl = process.env.NEXT_PUBLIC_STORAGE_IMPL || "dexie";
  if (!/^[a-z0-9-]+$/i.test(storageImpl)) {
    throw new Error(
      `Invalid NEXT_PUBLIC_STORAGE_IMPL "${storageImpl}". Expected a package suffix like "dexie" or "custom".`,
    );
  }

  return path.resolve(
    __dirname,
    `../../packages/core-${storageImpl}/src/index.ts`,
  );
}

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
    }),
    react(),
    securityHeadersPlugin(),
  ],
  resolve: {
    alias: {
      "@": __dirname,
      "next/dynamic": path.resolve(__dirname, "./src/next-shims/dynamic.tsx"),
      "next/link": path.resolve(__dirname, "./src/next-shims/link.tsx"),
      "next/navigation": path.resolve(
        __dirname,
        "./src/next-shims/navigation.ts",
      ),
      "@dashframe/core-store": getStorageBackendPath(),
    },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify(
      process.env.NODE_ENV ?? "development",
    ),
    "process.env.NEXT_PUBLIC_DEBUG": JSON.stringify(
      process.env.NEXT_PUBLIC_DEBUG ?? "",
    ),
    "process.env.NEXT_PUBLIC_POSTHOG_KEY": JSON.stringify(
      process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "",
    ),
    "process.env.NEXT_PUBLIC_POSTHOG_HOST": JSON.stringify(
      process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "",
    ),
    "process.env.NEXT_PUBLIC_STORAGE_IMPL": JSON.stringify(
      process.env.NEXT_PUBLIC_STORAGE_IMPL ?? "dexie",
    ),
    "process.env.PORT": JSON.stringify(process.env.PORT ?? "3000"),
  },
  server: {
    port: 3000,
    strictPort: false,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});

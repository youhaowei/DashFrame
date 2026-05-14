import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig, loadEnv, type Plugin } from "vite";

import { getSecurityHeaders } from "./lib/security-headers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DuckDB-WASM requires SharedArrayBuffer, which needs cross-origin isolation
// (COOP/COEP). Carries the CSP + security headers from the prior Next config
// across to Vite's dev + preview servers. Takes the resolved env so the CSP
// allowlist picks up `NEXT_PUBLIC_POSTHOG_HOST` from `.env*` files — Vite
// doesn't inject those into process.env during config resolution.
function securityHeadersPlugin(
  env: Record<string, string | undefined>,
): Plugin {
  const headers = {
    ...Object.fromEntries(getSecurityHeaders(env).map((h) => [h.key, h.value])),
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

function getStorageBackendPath(storageImpl: string) {
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

export default defineConfig(({ mode }) => {
  // Vite doesn't auto-inject `.env*` files into process.env during config
  // resolution; loadEnv reads them so the documented `.env.production`
  // backend selection (NEXT_PUBLIC_STORAGE_IMPL=custom) actually applies.
  // Empty prefix = load all keys, not just `VITE_*`.
  const env = { ...process.env, ...loadEnv(mode, __dirname, "") };
  const storageImpl = env.NEXT_PUBLIC_STORAGE_IMPL || "dexie";

  return {
    plugins: [
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
        routesDirectory: "./src/routes",
        generatedRouteTree: "./src/routeTree.gen.ts",
      }),
      react(),
      securityHeadersPlugin(env),
    ],
    resolve: {
      alias: {
        "@": __dirname,
        "@dashframe/core-store": getStorageBackendPath(storageImpl),
      },
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify(env.NODE_ENV ?? mode),
      "process.env.NEXT_PUBLIC_DEBUG": JSON.stringify(
        env.NEXT_PUBLIC_DEBUG ?? "",
      ),
      "process.env.NEXT_PUBLIC_POSTHOG_KEY": JSON.stringify(
        env.NEXT_PUBLIC_POSTHOG_KEY ?? "",
      ),
      "process.env.NEXT_PUBLIC_POSTHOG_HOST": JSON.stringify(
        env.NEXT_PUBLIC_POSTHOG_HOST ?? "",
      ),
      "process.env.NEXT_PUBLIC_STORAGE_IMPL": JSON.stringify(storageImpl),
      "process.env.PORT": JSON.stringify(env.PORT ?? "3000"),
    },
    server: {
      port: 3000,
      strictPort: false,
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});

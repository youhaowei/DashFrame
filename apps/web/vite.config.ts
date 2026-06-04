import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig, loadEnv, type Plugin } from "vite";

import { getSecurityHeaders } from "./lib/security-headers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The shared renderer (@dashframe/app). Both web and the Electron renderer host
// it: route tree generated from its routes dir, `@` aliased to its src.
const appSrcDir = path.resolve(__dirname, "../../packages/app/src");
const appRoutesDir = path.resolve(appSrcDir, "routes");

// DuckDB-WASM requires SharedArrayBuffer, which needs cross-origin isolation
// (COOP/COEP). Carries the CSP + security headers from the prior Next config
// across to:
//   - Vite's dev + preview servers (middleware)
//   - Static deployments (emits `_headers` for CloudFlare Pages / Netlify
//     and `vercel.json` for Vercel during `vite build` so the production
//     dist/ ships with the same CSP + COOP/COEP)
// Also emits `_redirects` for SPA-history fallback so deep links don't 404
// on a static host that doesn't auto-fallback to index.html.
// Takes the resolved env so the CSP allowlist picks up
// `NEXT_PUBLIC_POSTHOG_HOST` from `.env*` files.
function securityHeadersPlugin(
  env: Record<string, string | undefined>,
): Plugin {
  const headerPairs: Array<readonly [string, string]> = [
    ...getSecurityHeaders(env).map(
      (h) => [h.key, h.value] as readonly [string, string],
    ),
    ["Cross-Origin-Opener-Policy", "same-origin"] as const,
    ["Cross-Origin-Embedder-Policy", "require-corp"] as const,
  ];
  const apply = (res: { setHeader: (k: string, v: string) => void }) => {
    for (const [k, v] of headerPairs) res.setHeader(k, v);
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
    generateBundle() {
      // CloudFlare Pages / Netlify
      const headersFile =
        "/*\n" + headerPairs.map(([k, v]) => `  ${k}: ${v}`).join("\n") + "\n";
      this.emitFile({
        type: "asset",
        fileName: "_headers",
        source: headersFile,
      });

      // CloudFlare Pages / Netlify SPA fallback
      this.emitFile({
        type: "asset",
        fileName: "_redirects",
        source: "/*    /index.html   200\n",
      });

      // Vercel — combined headers + SPA rewrite
      const vercelConfig = {
        headers: [
          {
            source: "/(.*)",
            headers: headerPairs.map(([key, value]) => ({ key, value })),
          },
        ],
        rewrites: [{ source: "/(.*)", destination: "/index.html" }],
      };
      this.emitFile({
        type: "asset",
        fileName: "vercel.json",
        source: JSON.stringify(vercelConfig, null, 2) + "\n",
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Vite doesn't auto-inject `.env*` files into process.env during config
  // resolution. Empty prefix = load all keys, not just `VITE_*`.
  const env = { ...process.env, ...loadEnv(mode, __dirname, "") };

  // Resolve PORT once: portless injects it, Claude Preview sets it too.
  // Validate to a usable TCP port (1–65535) so the dev server config and
  // the client-injected `process.env.PORT` never disagree — a raw `"0"`,
  // non-numeric, or out-of-range value would otherwise leave them split.
  // Falls back to 3000 for a plain `vite` invocation.
  const rawPort = Number(env.PORT);
  const port =
    Number.isInteger(rawPort) && rawPort >= 1 && rawPort <= 65535
      ? rawPort
      : 3000;
  const wystackUrl = env.VITE_WYSTACK_URL?.trim();

  return {
    plugins: [
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
        // The full app lives in the shared @dashframe/app package; both web and
        // the Electron renderer point their router at it. The generated tree
        // stays host-local.
        routesDirectory: appRoutesDir,
        generatedRouteTree: "./src/routeTree.gen.ts",
      }),
      react(),
      securityHeadersPlugin(env),
    ],
    resolve: {
      alias: {
        // `@` now resolves into the shared package — the moved files' `@/...`
        // imports point at packages/app/src. Web-only files (PostHog, tRPC,
        // security-headers) use relative imports, not `@/`.
        "@": appSrcDir,
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
      "process.env.PORT": JSON.stringify(String(port)),
    },
    server: {
      port,
      strictPort: false,
      proxy: wystackUrl
        ? {
            "/api": {
              target: wystackUrl,
              changeOrigin: true,
              ws: true,
            },
          }
        : undefined,
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});

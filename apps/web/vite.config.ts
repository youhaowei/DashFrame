import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: false,
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
    }),
    react(),
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
      "geist/font/mono": path.resolve(
        __dirname,
        "./src/next-shims/geist-mono.ts",
      ),
      "geist/font/sans": path.resolve(
        __dirname,
        "./src/next-shims/geist-sans.ts",
      ),
      "@dashframe/core-store": path.resolve(
        __dirname,
        "../../packages/core-dexie/src/index.ts",
      ),
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

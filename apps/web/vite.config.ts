import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { trpcDevServer } from "./lib/trpc/vite-plugin";

export default defineConfig({
  server: {
    port: 3000,
    headers: {
      // Required for SharedArrayBuffer (DuckDB-WASM needs this during migration)
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  // Workspace packages export raw .ts — Vite's SSR transform must resolve them
  // (Node's native ESM loader can't handle extensionless .ts imports)
  ssr: {
    noExternal: [/^@dashframe\//],
  },
  plugins: [
    tsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tanstackStart({
      srcDirectory: "./src",
      spa: {
        enabled: true,
      },
    }),
    trpcDevServer(),
    tailwindcss(),
    react(),
  ],
});

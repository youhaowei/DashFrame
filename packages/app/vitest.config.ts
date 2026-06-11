import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  test: {
    // jsdom gives `window` + `localStorage`, needed by the persisted Zustand
    // stores (assistant dock preference) and any DOM-touching store logic.
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Route files need a host-generated route tree to typecheck/run; excluded.
    exclude: ["**/node_modules/**", "**/dist/**", "src/routes/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

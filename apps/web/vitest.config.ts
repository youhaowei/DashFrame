import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Cast to any due to Vite version mismatch between @vitejs/plugin-react and vitest
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plugins: [react() as any],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["lib/**/*.{ts,tsx}", "hooks/**/*.{ts,tsx}"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.stories.{ts,tsx}",
        "**/__tests__/**",
        "**/node_modules/**",
        "**/dist/**",
        "**/.next/**",
      ],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
      "@dashframe/ui": path.resolve(__dirname, "../../packages/ui/src"),
      "@dashframe/core": path.resolve(__dirname, "../../packages/core/src"),
      "@dashframe/engine": path.resolve(__dirname, "../../packages/engine/src"),
      "@dashframe/engine-browser": path.resolve(
        __dirname,
        "../../packages/engine-browser/src",
      ),
      "@dashframe/connector-csv": path.resolve(
        __dirname,
        "../../packages/connector-csv/src",
      ),
      "@dashframe/connector-notion": path.resolve(
        __dirname,
        "../../packages/connector-notion/src",
      ),
    },
  },
});

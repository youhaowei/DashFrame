import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
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

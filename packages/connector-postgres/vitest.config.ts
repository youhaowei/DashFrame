import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/__tests__/**",
        "**/node_modules/**",
        "**/dist/**",
      ],
    },
  },
  resolve: {
    alias: {
      "@dashframe/engine": path.resolve(__dirname, "../engine/src"),
      "@wystack/secret-vault": path.resolve(
        __dirname,
        "../../libs/wystack/packages/secret-vault/src/index.ts",
      ),
    },
  },
});

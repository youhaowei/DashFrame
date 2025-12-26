import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@dashframe/engine": path.resolve(__dirname, "../engine/src"),
      "@dashframe/engine-browser": path.resolve(
        __dirname,
        "../engine-browser/src",
      ),
    },
  },
});

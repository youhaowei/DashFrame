import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});

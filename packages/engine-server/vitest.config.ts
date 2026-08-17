import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    testTimeout: 30_000,
    include: ["**/*.test.{ts,tsx}"],
  },
});

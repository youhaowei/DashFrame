import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    env: { DASHFRAME_DEPLOYMENT_MODE: "local" },
    include: ["test/**/*.test.ts"],
    pool: "forks",
    maxWorkers: 1,
    minWorkers: 1,
  },
});

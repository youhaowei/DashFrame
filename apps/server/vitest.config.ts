import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite-plus";

const configDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.{ts,tsx}"],
    // Host integration tests start local services and exercise filesystem I/O.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@dashframe/assistant": path.resolve(
        configDir,
        "../../packages/assistant/src",
      ),
      "@dashframe/server-core": path.resolve(
        configDir,
        "../../packages/server-core/src",
      ),
    },
  },
});

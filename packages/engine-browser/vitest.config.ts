import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@dashframe/engine": path.resolve(__dirname, "../engine/src"),
      "@dashframe/types": path.resolve(__dirname, "../types/src"),
    },
  },
});

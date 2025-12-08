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
      "@dashframe/dataframe": path.resolve(
        __dirname,
        "../../packages/dataframe/src",
      ),
    },
  },
});

import path from "node:path";
import { defineConfig } from "vite-plus";

export default defineConfig({
  root: import.meta.dirname,
  css: { postcss: path.resolve(import.meta.dirname, "../../../../apps/web") },
  server: { host: "127.0.0.1", port: 4382, strictPort: true },
});

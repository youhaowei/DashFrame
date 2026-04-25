/**
 * Preload bridge. Exposes a single `dashframe.transport` object on the
 * renderer's `window`. Renderer code uses `@dashframe/transport/ipc/renderer`
 * to wrap the bridge in a typed `Transport`.
 *
 * Per Greptile P2 on PR #30: shared types live in `@dashframe/types`, NOT
 * here, so the renderer can import them without a stale CJS preload bundle
 * leaking into its module graph.
 */
import { createPreloadBridge } from "@dashframe/transport/ipc/preload";
import { contextBridge, ipcRenderer } from "electron";

const bridge = createPreloadBridge(ipcRenderer);

contextBridge.exposeInMainWorld("dashframe", {
  version: "0.2.0-alpha.0",
  transport: bridge,
});

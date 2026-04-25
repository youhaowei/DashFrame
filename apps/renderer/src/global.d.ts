/**
 * Ambient typing for the preload-exposed surface. The preload script
 * injects `window.dashframe` via `contextBridge.exposeInMainWorld`; we
 * declare its shape here so renderer code stays typed without reaching
 * into the preload bundle (which the renderer can't import — it's CJS,
 * runs in the isolated preload world, and is bundled separately).
 *
 * Resolves the Greptile P2 from PR #30: shared types live in
 * `@dashframe/types` and `@dashframe/transport`, both renderer-importable.
 */
import type { PreloadIpcBridge } from "@dashframe/transport/ipc/preload";

declare global {
  interface Window {
    dashframe: {
      version: string;
      transport: PreloadIpcBridge;
    };
  }
}

export {};

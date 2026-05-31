import type { DashFrameApi } from "@dashframe/desktop-types";
import type { IpcRendererLike } from "@wystack/client/electron";

declare global {
  interface Window {
    dashframe: DashFrameApi;
    /** WyStack IPC bridge exposed by preload — satisfies IpcRendererLike. */
    wysIpc: IpcRendererLike;
  }
}

export {};

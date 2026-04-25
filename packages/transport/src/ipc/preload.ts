/**
 * Preload-side IPC adapter. Runs in Electron's isolated preload context
 * (CJS, sandbox-friendly) and exposes a `Transport` over `contextBridge`.
 *
 * The preload script wraps this in `contextBridge.exposeInMainWorld(...)`.
 * The renderer never touches `ipcRenderer` directly — it only sees the
 * `Transport` shape exposed here.
 *
 * Important: `contextBridge` clones what you pass through it, so the
 * Transport object exposed must be plain functions and primitive return
 * values. Subscription `Subscription` handles are reconstructed renderer-
 * side because their methods would otherwise be detached from preload
 * state. We expose a pair of low-level primitives (`invoke`, `subscribe`,
 * `unsubscribe`, `onEvent`) and let the renderer assemble them into a
 * `Transport` via `createIpcRendererTransport`.
 */
import type { IpcRenderer } from "electron";

import type {
  RpcRequest,
  RpcResponse,
  RpcSubscribeRequest,
  RpcSubscriptionEvent,
} from "@dashframe/types";

import { IPC_CHANNELS } from "./channels";

export interface PreloadIpcBridge {
  invoke(req: RpcRequest): Promise<RpcResponse>;
  subscribe(req: RpcSubscribeRequest): Promise<RpcResponse>;
  unsubscribe(payload: { id: string; subId: string }): Promise<RpcResponse>;
  /**
   * Subscribe to subscription event pushes. Returns a teardown function.
   * Renderer-side fans these out by `subId` to the registered observers.
   */
  onEvent(listener: (event: RpcSubscriptionEvent) => void): () => void;
}

export function createPreloadBridge(
  ipcRenderer: IpcRenderer,
): PreloadIpcBridge {
  return {
    invoke: (req) => ipcRenderer.invoke(IPC_CHANNELS.invoke, req),
    subscribe: (req) => ipcRenderer.invoke(IPC_CHANNELS.subscribe, req),
    unsubscribe: (payload) =>
      ipcRenderer.invoke(IPC_CHANNELS.unsubscribe, payload),
    onEvent(listener) {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: RpcSubscriptionEvent,
      ) => listener(payload);
      ipcRenderer.on(IPC_CHANNELS.event, handler);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.event, handler);
      };
    },
  };
}

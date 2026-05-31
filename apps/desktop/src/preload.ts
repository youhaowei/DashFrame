import { contextBridge, ipcRenderer } from "electron";

import type { DashFrameApi, ProjectInfo } from "@dashframe/desktop-types";

/**
 * IPC surface exposed to the renderer. Keep the shape narrow and serializable:
 * the main process owns filesystem access and the artifact DB. The renderer
 * asks for actions via named channels instead of receiving raw project paths.
 */
const api: DashFrameApi = {
  project: {
    getInfo: (): Promise<ProjectInfo> =>
      ipcRenderer.invoke("dashframe:project:info"),
    revealFolder: (): Promise<void> =>
      ipcRenderer.invoke("dashframe:project:reveal"),
  },
} as const;

contextBridge.exposeInMainWorld("dashframe", api);

/**
 * WyStack IPC bridge — exposes a minimal IpcRendererLike surface scoped to
 * the `wystack:c2s` / `wystack:s2c` channels. Satisfies the structural
 * interface the `@wystack/client/electron` adapter expects without leaking
 * raw ipcRenderer into the renderer process.
 *
 * `contextBridge.exposeInMainWorld` can't transport class instances or
 * functions with non-serializable closures — every method is a plain function
 * that re-dispatches to ipcRenderer. `removeListener` must correlate the same
 * wrapper reference the adapter registered via `on`, so we keep a WeakMap of
 * original→wrapper to survive the context bridge crossing.
 */
const WYSTACK_CHANNELS = new Set(["wystack:c2s", "wystack:s2c"]);

// Map from the renderer-side callback to the ipcRenderer wrapper so
// removeListener can unregister the exact function that was registered.
const listenerMap = new WeakMap<
  (...args: unknown[]) => void,
  (event: Electron.IpcRendererEvent, ...args: unknown[]) => void
>();

contextBridge.exposeInMainWorld("wysIpc", {
  send(channel: string, ...args: unknown[]): void {
    if (!WYSTACK_CHANNELS.has(channel)) return;
    ipcRenderer.send(channel, ...args);
  },
  on(channel: string, listener: (...args: unknown[]) => void): void {
    if (!WYSTACK_CHANNELS.has(channel)) return;
    // The adapter receives (event, message) from ipcRenderer but only reads
    // args[1] (the message) via the IpcRendererLike interface which gives
    // (event, ...args). We pass (null, payload) so the adapter sees event=null
    // and the payload as the first variadic arg.
    const wrapper = (_event: Electron.IpcRendererEvent, ...rest: unknown[]) => {
      listener(null, ...rest);
    };
    listenerMap.set(listener, wrapper);
    ipcRenderer.on(channel, wrapper);
  },
  removeListener(
    channel: string,
    listener: (...args: unknown[]) => void,
  ): void {
    if (!WYSTACK_CHANNELS.has(channel)) return;
    const wrapper = listenerMap.get(listener);
    if (wrapper) {
      ipcRenderer.removeListener(channel, wrapper);
      listenerMap.delete(listener);
    }
  },
});

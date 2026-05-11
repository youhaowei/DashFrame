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

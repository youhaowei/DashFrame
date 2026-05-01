import { contextBridge, ipcRenderer } from "electron";

/**
 * IPC surface exposed to the renderer. Keep the shape narrow and serializable:
 * the main process owns filesystem access and the artifact DB. The renderer
 * asks for actions via named channels instead of receiving raw project paths.
 */
const api = {
  project: {
    getInfo: (): Promise<ProjectInfo> =>
      ipcRenderer.invoke("dashframe:project:info"),
    revealFolder: (): Promise<void> =>
      ipcRenderer.invoke("dashframe:project:reveal"),
  },
} as const;

export interface ProjectInfo {
  projectId: string;
  name: string;
  version: string;
  schemaVersion: number;
  createdAt: string;
  createdBy: string;
}

export type DashFrameApi = typeof api;

contextBridge.exposeInMainWorld("dashframe", api);

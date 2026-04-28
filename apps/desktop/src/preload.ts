import { contextBridge, ipcRenderer } from "electron";

/**
 * IPC surface exposed to the renderer. Keep the shape narrow and serializable:
 * the main process owns the artifact DB, and the renderer only reads metadata
 * via named channels. Future channels (query, mutate) grow from here.
 */
const api = {
  version: "0.2.0-alpha.0",
  project: {
    getInfo: (): Promise<ProjectInfo> =>
      ipcRenderer.invoke("dashframe:project:info"),
  },
} as const;

export interface ProjectInfo {
  dir: string;
  dbPath: string;
  dataSourcesDir: string;
  projectId: string;
  name: string;
  schemaVersion: number;
  createdAt: string;
  createdBy: string;
}

export type DashFrameApi = typeof api;

contextBridge.exposeInMainWorld("dashframe", api);

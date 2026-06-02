export interface ProjectInfo {
  projectId: string;
  name: string;
  version: string;
  schemaVersion: number;
  createdAt: string;
  createdBy: string;
}

/** Loopback connection details for the WyStack server the renderer talks to. */
export interface ServerInfo {
  /** Base URL including the `/api` prefix, e.g. `http://127.0.0.1:53017/api`. */
  url: string;
}

export interface DashFrameApi {
  project: {
    getInfo(): Promise<ProjectInfo>;
    revealFolder(): Promise<void>;
  };
  /** Returns the loopback WyStack server URL, available once main has started it. */
  getServerInfo(): Promise<ServerInfo>;
}

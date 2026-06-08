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
  /**
   * Base origin only — NO `/api` prefix, e.g. `http://127.0.0.1:53017`. The
   * WyStack client appends its own route prefix (`/api`), so including it here
   * would produce a double `/api/api` path and break every query.
   */
  url: string;
  /**
   * Per-launch loopback bearer token minted by Electron main. The renderer
   * supplies it through WyStack's getToken hook for HTTP and WS auth.
   */
  token: string;
}

export interface DashFrameApi {
  project: {
    getInfo(): Promise<ProjectInfo>;
    revealFolder(): Promise<void>;
  };
  /** Returns the loopback WyStack server URL, available once main has started it. */
  getServerInfo(): Promise<ServerInfo>;
}

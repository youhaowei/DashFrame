export interface ProjectInfo {
  workspaceId: string;
  name: string;
}

/** Application-only connection details; never includes Convex administrator keys. */
export interface ServerInfo {
  /** Loopback host HTTP origin for imports, sessions, and DuckDB queries. */
  url: string;
  /** Per-launch host bearer token; exchanged for a short-lived Convex JWT. */
  token: string;
  /** Loopback native Convex HTTP/WebSocket origin. */
  convexUrl: string;
}

export interface DashFrameApi {
  project: {
    getInfo(): Promise<ProjectInfo>;
    revealFolder(): Promise<void>;
  };
  oauth: {
    /** Opens a server-issued Google authorization URL in the system browser. */
    openAuthorizationUrl(url: string): Promise<void>;
  };
  /** Returns the loopback host and Convex URLs, available once main has started it. */
  getServerInfo(): Promise<ServerInfo>;
}

export interface ProjectInfo {
  projectId: string;
  name: string;
  version: string;
  schemaVersion: number;
  createdAt: string;
  createdBy: string;
}

export interface DashFrameApi {
  project: {
    getInfo(): Promise<ProjectInfo>;
    revealFolder(): Promise<void>;
  };
}

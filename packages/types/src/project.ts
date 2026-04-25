/**
 * Wire shape of `project.info` — the metadata snapshot a client needs to
 * render the shell. Mirrors `ProjectHandle` from `@dashframe/server-core`
 * but flattens dates to ISO strings so the payload survives JSON transport
 * (Electron IPC, future WS) without bespoke revivers.
 */
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

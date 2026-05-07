import { contextBridge } from "electron";

// Placeholder contextBridge. Expose future IPC surface here as the v0.2 desktop
// shell grows (native DuckDB handles, file-system access, WyStack transport).
contextBridge.exposeInMainWorld("dashframe", {
  version: "0.2.0-alpha.0",
});

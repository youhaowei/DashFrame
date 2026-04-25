import { openProject, type ProjectHandle } from "@dashframe/server-core";
import { Router } from "@dashframe/transport";
import { registerIpcMainTransport } from "@dashframe/transport/ipc/main";
import type { ProjectInfo } from "@dashframe/types";
import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";

const DEV_URL = process.env.DEV_URL ?? "http://localhost:5173";
const isDev = !app.isPackaged;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const loaded = isDev
    ? win.loadURL(DEV_URL)
    : win.loadFile(
        path.join(
          import.meta.dirname,
          "..",
          "..",
          "renderer",
          "dist",
          "index.html",
        ),
      );
  loaded.catch((err) => console.error("[dashframe] window load failed:", err));
}

/**
 * Build the RPC `Router` for the desktop app. All future channels (queries,
 * mutations, subscriptions) register here — `main.ts` should NOT grow new
 * `ipcMain.handle` calls. Adding a route is a one-liner against the router;
 * the IPC adapter dispatches automatically.
 */
function buildRouter(handle: ProjectHandle): Router {
  const router = new Router();

  router.invoke("project.info", (): ProjectInfo => {
    return {
      dir: handle.dir,
      dbPath: handle.dbPath,
      dataSourcesDir: handle.dataSourcesDir,
      projectId: handle.meta.projectId,
      name: handle.meta.name,
      schemaVersion: handle.meta.schemaVersion,
      createdAt: handle.meta.createdAt.toISOString(),
      createdBy: handle.meta.createdBy,
    };
  });

  return router;
}

await app.whenReady();
const project = await openProject();
console.log(`[dashframe] project ready at ${project.dir}`);

const router = buildRouter(project);
registerIpcMainTransport({ ipcMain, router });

createWindow();

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

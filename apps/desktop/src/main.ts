import { openProject, type ProjectHandle } from "@dashframe/server-core";
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

function registerIpc(handle: ProjectHandle): void {
  ipcMain.handle("dashframe:project:info", () => ({
    dir: handle.dir,
    dbPath: handle.dbPath,
    dataSourcesDir: handle.dataSourcesDir,
    projectId: handle.meta.projectId,
    name: handle.meta.name,
    schemaVersion: handle.meta.schemaVersion,
    createdAt: handle.meta.createdAt.toISOString(),
    createdBy: handle.meta.createdBy,
  }));
}

await app.whenReady();
const project = await openProject();
console.log(`[dashframe] project ready at ${project.dir}`);
registerIpc(project);
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

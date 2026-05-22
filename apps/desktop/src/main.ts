import { openProject, type ProjectHandle } from "@dashframe/server-core";
import type { Event as ElectronEvent } from "electron";
import { app, BrowserWindow, dialog } from "electron";
import path from "node:path";

import { registerDesktopIpc } from "./ipc";

const DEV_URL = process.env.DEV_URL ?? "http://localhost:5173";
const isDev = !app.isPackaged;
let project: ProjectHandle | null = null;
let isClosingProject = false;

async function closeProjectBeforeQuit(event: ElectronEvent): Promise<void> {
  if (isClosingProject || !project) return;

  event.preventDefault();
  isClosingProject = true;
  try {
    await project.close();
  } catch (err) {
    console.error("[dashframe] error closing project DB:", err);
  } finally {
    app.quit();
  }
}

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

console.log("[dashframe] main process started, waiting for app ready...");

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app
  .whenReady()
  .then(async () => {
    console.log("[dashframe] app ready, opening project...");

    try {
      project = await openProject();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[dashframe] failed to open project:", err);
      dialog.showErrorBox(
        "DashFrame failed to start",
        `Could not open project: ${message}`,
      );
      app.exit(1);
      return;
    }

    console.log(`[dashframe] project ready at ${project.dir}`);
    registerDesktopIpc(project);
    app.on("before-quit", closeProjectBeforeQuit);

    console.log(`[dashframe] creating window with DEV_URL=${DEV_URL}...`);
    createWindow();
    console.log("[dashframe] window created");

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  })
  .catch((err) => {
    console.error("[dashframe] startup failed:", err);
    app.exit(1);
  });

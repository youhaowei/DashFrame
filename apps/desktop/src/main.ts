import {
  ARTIFACTS_DB_FILENAME,
  openProject,
  type ProjectHandle,
} from "@dashframe/server-core";
import type { WyStackApp } from "@wystack/server";
import { createSubscriptionManager } from "@wystack/server";
import { attachElectronTransport } from "@wystack/server/electron";
import type { Event as ElectronEvent } from "electron";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";

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

/**
 * Build a WyStackApp that serves the `projectInfo` query directly from the
 * ProjectHandle's in-memory meta — no DB round-trip needed for this data.
 * The app interface is satisfied manually (no `createWyStack`) to avoid an
 * extra DB connection and the async setup overhead.
 */
function buildWyStackApp(handle: ProjectHandle): WyStackApp {
  return {
    functions: new Map([
      [
        "projectInfo",
        {
          type: "query" as const,
          path: "projectInfo",
          args: {},
          handler: async () => ({
            projectId: handle.meta.projectId,
            name: handle.meta.name,
            version: handle.meta.version,
            schemaVersion: handle.meta.schemaVersion,
            createdAt: handle.meta.createdAt.toISOString(),
            createdBy: handle.meta.createdBy,
          }),
        },
      ],
    ]),
    subscriptions: createSubscriptionManager(),
    async call(funcPath, args) {
      const fn = this.functions.get(funcPath);
      if (!fn) throw new Error(`Unknown function: ${funcPath}`);
      // projectInfo has no args and doesn't use ctx.db — pass a minimal context
      const result = await fn.handler({ db: null as never }, args);
      return {
        result,
        tablesRead: new Set<string>(),
        tablesWritten: new Set<string>(),
      };
    },
  };
}

function createWindow(): BrowserWindow {
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

  return win;
}

function registerIpc(handle: ProjectHandle): void {
  ipcMain.handle("dashframe:project:info", () => ({
    projectId: handle.meta.projectId,
    name: handle.meta.name,
    version: handle.meta.version,
    schemaVersion: handle.meta.schemaVersion,
    createdAt: handle.meta.createdAt.toISOString(),
    createdBy: handle.meta.createdBy,
  }));
  ipcMain.handle("dashframe:project:reveal", () => {
    shell.showItemInFolder(path.join(handle.dir, ARTIFACTS_DB_FILENAME));
  });
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
    registerIpc(project);
    app.on("before-quit", closeProjectBeforeQuit);

    // Mount the WyStack server over Electron IPC.
    // `getWebContents` defaults to `event.sender` — no window ref needed at
    // mount time; each renderer's first frame opens its own connection.
    const wyStackApp = buildWyStackApp(project);
    const { detach } = attachElectronTransport({
      app: wyStackApp,
      ipcMain,
      // No resolveContext — trusted in-process transport, no auth handshake.
    });
    app.on("before-quit", () => detach());

    console.log("[dashframe] WyStack IPC transport mounted");

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

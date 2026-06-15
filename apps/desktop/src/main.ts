import {
  NativeDuckDBEngine,
  selectEngineBinding,
} from "@dashframe/engine-server";
import {
  ARTIFACTS_DB_FILENAME,
  openProject,
  type ProjectHandle,
} from "@dashframe/server-core";
import {
  createDashframeServer,
  type DashframeServer,
} from "@dashframe/server/app";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { randomBytes } from "node:crypto";
import path from "node:path";

import { Lifecycle } from "./lifecycle.js";

const DEV_URL = process.env.DEV_URL ?? "http://localhost:5173";
const isDev = !app.isPackaged;

// Single owner of this launch's closable handles + the shutdown guard. main.ts
// holds exactly one instance; shutdown drains whatever has been registered so
// far, so a startup error that fired after engine init still disposes it.
const lifecycle = new Lifecycle((code) => app.exit(code));

function createLoopbackToken(): string {
  return randomBytes(32).toString("base64url");
}

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    // macOS only: hide the title bar but keep the traffic lights, inset over the
    // app's own top bar (the renderer reserves a spacer for them in AppTopBar).
    // On Windows/Linux `hiddenInset` would hide the title bar *without* giving
    // back window controls, so keep the standard frame there until the app
    // draws its own controls.
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const }
      : {}),
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    await (isDev
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
        ));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[dashframe] window load failed:", err);
    dialog.showErrorBox(
      "DashFrame failed to start",
      `Could not load the application window: ${message}`,
    );
    // Window load failure is fatal — the app is running with an inert window
    // and cannot recover. Trigger graceful shutdown and exit.
    await lifecycle.shutdown(1);
  }
}

function registerIpc(
  handle: ProjectHandle,
  srv: DashframeServer,
  authToken: string,
): void {
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
  // The renderer connects to this loopback WyStack server as a localhost web
  // client — same client + transport as the cloud web client (per the Data
  // Path & Transport Deployment spec). It needs the ephemeral port main bound.
  ipcMain.handle("dashframe:server:info", () => ({
    url: srv.url,
    token: authToken,
  }));
}

console.log("[dashframe] main process started, waiting for app ready...");

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (!lifecycle.hasProject()) return;
  event.preventDefault();
  lifecycle.shutdown(0).catch((err: unknown) => {
    console.error("[dashframe] shutdown failed:", err);
  });
});

app
  .whenReady()
  .then(async () => {
    console.log("[dashframe] app ready, opening project...");

    // DuckDB-WASM (the data pipeline in @dashframe/app) needs SharedArrayBuffer,
    // which requires cross-origin isolation. In dev the renderer's Vite server
    // sets COOP/COEP; for the packaged file:// renderer there's no HTTP layer,
    // so inject the headers on every response here.
    const { session } = await import("electron");
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Cross-Origin-Opener-Policy": ["same-origin"],
          "Cross-Origin-Embedder-Policy": ["require-corp"],
        },
      });
    });

    let project: ProjectHandle;
    let authToken: string;
    try {
      project = await openProject();
      lifecycle.setProject(project);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[dashframe] failed to open project:", err);
      dialog.showErrorBox(
        "DashFrame failed to start",
        `Could not open project: ${message}`,
      );
      await lifecycle.shutdown(1);
      return;
    }

    console.log(`[dashframe] project ready at ${project.dir}`);

    // Surface recovery notice when the project was restored from a snapshot.
    if (project.recovery) {
      const { restoredSnapshot, quarantinedPath } = project.recovery;
      const snapshotLine = restoredSnapshot
        ? `Your project was restored from a snapshot taken at ${new Date(restoredSnapshot.timestamp).toLocaleString()}.`
        : "No snapshot was available — a fresh empty project has been created.";
      const quarantineLine = `The damaged database has been saved to:\n${quarantinedPath}`;
      dialog.showMessageBoxSync({
        type: "warning",
        title: "Project recovered",
        message: "DashFrame recovered your project after an unclean shutdown.",
        detail: `${snapshotLine}\n\nAny changes made since the last snapshot are not recoverable.\n\n${quarantineLine}`,
        buttons: ["Continue"],
      });
    }

    let server: DashframeServer;
    try {
      // Dev uses the Vite origin from DEV_URL. Packaged Electron loads the
      // renderer from file://, which browsers send as Origin: null; allow that
      // origin while relying on the per-launch bearer token for authority.
      const corsOrigin = isDev ? new URL(DEV_URL).origin : "null";
      authToken = createLoopbackToken();

      // Desktop resolves to the native DuckDB engine (engine selection policy,
      // one place). It backs the dedicated Arrow IPC data path on the loopback
      // server — Electron main stays a thin host; the engine lives in the
      // server process, not main proper.
      const binding = selectEngineBinding("desktop");
      console.log(`[dashframe] engine binding: ${binding}`);
      const engine = new NativeDuckDBEngine();
      await engine.initialize();
      lifecycle.setEngine(engine);
      console.log("[dashframe] native DuckDB engine ready");

      server = await createDashframeServer({
        db: project.db,
        corsOrigin,
        authToken,
        arrowEngine: engine,
        // Wire the debounced snapshot scheduler: fire touchSnapshot after every
        // committed artifact-DB write so a crash mid-session loses at most
        // SNAPSHOT_DEBOUNCE_MS (30 s) of changes rather than the whole session.
        // The server owns no reference to ProjectHandle — the narrow callback
        // is the boundary (#88).
        onWrite: () => project.touchSnapshot(),
      });
      lifecycle.setServer(server);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[dashframe] failed to start server:", err);
      dialog.showErrorBox(
        "DashFrame failed to start",
        `Could not start the local server: ${message}`,
      );
      await lifecycle.shutdown(1);
      return;
    }
    console.log(`[dashframe] loopback server ready at ${server.url}`);

    registerIpc(project, server, authToken);

    console.log(`[dashframe] creating window with DEV_URL=${DEV_URL}...`);
    await createWindow();
    console.log("[dashframe] window created");

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow().catch((err: unknown) => {
          console.error("[dashframe] window re-creation failed:", err);
        });
      }
    });
  })
  .catch((err: unknown) => {
    console.error("[dashframe] startup failed:", err);
    lifecycle.shutdown(1).catch((shutdownErr: unknown) => {
      console.error("[dashframe] shutdown failed:", shutdownErr);
    });
  });

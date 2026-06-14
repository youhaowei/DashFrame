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
import type { Event as ElectronEvent } from "electron";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { randomBytes } from "node:crypto";
import path from "node:path";

const DEV_URL = process.env.DEV_URL ?? "http://localhost:5173";
const isDev = !app.isPackaged;
let project: ProjectHandle | null = null;
let server: DashframeServer | null = null;
let engine: NativeDuckDBEngine | null = null;
let isClosingProject = false;

function createLoopbackToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Best-effort graceful shutdown.
 *
 * Used by BOTH the normal `before-quit` path AND every startup-error path so
 * partially-initialised handles (engine, project) are never terminated mid-
 * flight without a chance to flush/close. Each step is individually guarded
 * so one failure does not skip the rest.
 *
 * @param exitCode Exit code to pass to `app.exit()` after cleanup.
 */
export async function shutdown(exitCode: number): Promise<void> {
  // Prevent re-entrant calls (e.g. a `before-quit` firing while a startup
  // error path is already draining).
  if (isClosingProject) return;
  isClosingProject = true;

  try {
    server?.stop();
  } catch (err) {
    console.error("[dashframe] error stopping server:", err);
  }
  try {
    await engine?.dispose();
  } catch (err) {
    console.error("[dashframe] error disposing engine:", err);
  }
  try {
    await project?.close();
  } catch (err) {
    console.error("[dashframe] error closing project DB:", err);
  }

  app.exit(exitCode);
}

/**
 * Reset shutdown-guard state. For testing only — lets tests reset the
 * `isClosingProject` flag between cases without re-importing the module.
 */
export function _resetShutdownGuard(): void {
  isClosingProject = false;
}

/**
 * Inject test doubles for the module-level handles. For testing only — lets
 * tests assert that shutdown drains the mocked handles in the right order.
 */
export function _injectHandles(opts: {
  project?: ProjectHandle | null;
  server?: DashframeServer | null;
  engine?: NativeDuckDBEngine | null;
}): void {
  if ("project" in opts) project = opts.project ?? null;
  if ("server" in opts) server = opts.server ?? null;
  if ("engine" in opts) engine = opts.engine ?? null;
}

async function closeProjectBeforeQuit(event: ElectronEvent): Promise<void> {
  if (isClosingProject || !project) return;

  event.preventDefault();
  await shutdown(0);
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
    await shutdown(1);
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

    let authToken: string;
    try {
      project = await openProject();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[dashframe] failed to open project:", err);
      dialog.showErrorBox(
        "DashFrame failed to start",
        `Could not open project: ${message}`,
      );
      await shutdown(1);
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
      engine = new NativeDuckDBEngine();
      await engine.initialize();
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
        onWrite: () => project?.touchSnapshot(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[dashframe] failed to start server:", err);
      dialog.showErrorBox(
        "DashFrame failed to start",
        `Could not start the local server: ${message}`,
      );
      await shutdown(1);
      return;
    }
    console.log(`[dashframe] loopback server ready at ${server.url}`);

    registerIpc(project, server, authToken);
    app.on("before-quit", closeProjectBeforeQuit);

    console.log(`[dashframe] creating window with DEV_URL=${DEV_URL}...`);
    await createWindow();
    console.log("[dashframe] window created");

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow();
      }
    });
  })
  .catch((err) => {
    console.error("[dashframe] startup failed:", err);
    void shutdown(1);
  });

import {
  NativeDuckDBEngine,
  selectEngineBinding,
} from "@dashframe/engine-server";
import {
  ARTIFACTS_DB_FILENAME,
  DrizzleMappingStore,
  openProject,
  type ProjectHandle,
} from "@dashframe/server-core";
import {
  createDashframeServer,
  type DashframeServer,
} from "@dashframe/server/app";
import {
  isSecretRef,
  SecretRegistry,
  SecretVault,
  type SecretRef,
} from "@wystack/secret-vault";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { Lifecycle } from "./lifecycle.js";
import { ElectronKeychainBackend } from "./secret-keychain-backend.js";

const DEV_URL = process.env.DEV_URL ?? "http://localhost:5173";
const isDev = !app.isPackaged;

// Single owner of this launch's closable handles + the shutdown guard. main.ts
// holds exactly one instance; shutdown drains whatever has been registered so
// far, so a startup error that fired after engine init still disposes it.
const lifecycle = new Lifecycle((code) => app.exit(code));

// Module-level holders — assigned once in whenReady after the project dir is
// known. Must outlive the whenReady callback so they remain alive for the
// full process lifetime (secrets are resolved throughout the session).
let secretRegistry: SecretRegistry | null = null;
let secretVault: SecretVault | null = null;

function createLoopbackToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Sidecar marker recording the current launch's serve-token vault ref. */
const SERVE_TOKEN_REF_FILE = "serve-token.ref";

/**
 * Result of provisioning the per-launch serve token. A discriminated union so
 * exactly one path is type-enforced (never both, never neither):
 *   - `authRef`   — vault-backed path (keychain available). The server resolves
 *                   the token from the vault; no plaintext at the server.
 *   - `authToken` — process-memory fallback (keychain unavailable). The token
 *                   lives only in memory for this launch; never written at rest.
 */
type ServeTokenResult =
  | { authRef: SecretRef; authToken?: undefined }
  | { authToken: string; authRef?: undefined };

/**
 * Provision the per-launch serve token through the SecretVault, with two
 * non-happy-path behaviors:
 *
 *   1. Stale-entry cleanup — read the prior launch's ref from the sidecar
 *      marker and `vault.delete` it before storing the new token, so the
 *      `secret_mappings` row + keychain blob from the previous launch do not
 *      accumulate unbounded. The new ref is then written back to the marker.
 *
 *   2. Keychain-unavailable fallback — the serve token is ephemeral (minted
 *      every launch, never resolved across restarts). When the OS keychain is
 *      unavailable (e.g. Linux without libsecret, or the rejected `basic_text`
 *      backend), `vault.store` throws; rather than blocking startup, fall back
 *      to a process-memory token. Plaintext-never-AT-REST is preserved either
 *      way — the fallback keeps the token only in memory.
 */
async function storeServeToken(
  vault: SecretVault,
  projectDir: string,
  token: string,
): Promise<ServeTokenResult> {
  const markerPath = path.join(projectDir, SERVE_TOKEN_REF_FILE);

  // Cleanup: delete the prior launch's serve-token entry (mapping row + blob).
  // Best-effort — a missing/corrupt marker or a delete failure must not block
  // startup; the worst case is one orphaned entry, not a broken launch.
  try {
    const prior = (await fs.readFile(markerPath, "utf8")).trim();
    if (isSecretRef(prior)) {
      await vault.delete(prior);
    }
  } catch {
    // No prior marker (first launch) or unreadable — nothing to clean up.
  }

  try {
    const authRef = await vault.store(token, { class: "serve-token" });
    // Persist the new ref so the next launch can clean it up. Best-effort: a
    // write failure only risks a future orphan, not this launch.
    try {
      await fs.writeFile(markerPath, authRef, { mode: 0o600 });
    } catch (err) {
      console.warn(
        "[dashframe] could not persist serve-token marker (cleanup may orphan one entry):",
        err,
      );
    }
    return { authRef };
  } catch (err) {
    // Keychain unavailable — the serve token is ephemeral, so degrade to a
    // process-memory token instead of failing startup. Remove any stale marker
    // (the vault path is not in use this launch).
    console.warn(
      "[dashframe] vault unavailable for serve token; falling back to in-memory token (not at rest):",
      err,
    );
    await fs.rm(markerPath, { force: true }).catch(() => {});
    return { authToken: token };
  }
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

    // Register the OS-keychain backend for all credential classes.
    // The keychain blobs live alongside the project data so they survive moves
    // of the app binary while staying co-located with the project they protect.
    // This registration is Electron-main-only — it is never executed in web/CI.
    const keychainStorageDir = path.join(project.dir, "keychain");
    const { safeStorage } = await import("electron");
    const keychainBackend = new ElectronKeychainBackend(
      keychainStorageDir,
      safeStorage,
    );
    secretRegistry = new SecretRegistry();
    secretRegistry.register("electron-keychain", keychainBackend, {
      fallback: true,
    });
    secretRegistry.setClassDefault("connector-key", "electron-keychain");
    secretRegistry.setClassDefault("serve-token", "electron-keychain");
    // Compose the vault from the registry. The mapping store persists the
    // ref→{backend, locator} binding in the project DB (`secret_mappings` table)
    // so refs stay resolvable across restarts: the ref in `data_sources.config`,
    // the encrypted blob in the keychain, and this mapping all share one
    // transactional/backup boundary and can never drift. An in-memory store would
    // drop the mapping on restart, leaving every persisted credential permanently
    // unresolvable (has(ref) → false, withSecret(ref) → throw).
    secretVault = new SecretVault(
      secretRegistry,
      new DrizzleMappingStore(project.db),
    );
    console.log(
      `[dashframe] keychain backend registered, vault composed (storageDir=${keychainStorageDir})`,
    );

    // No plaintext-credential migration: this is pre-release and no data source
    // has ever stored a plaintext credential. New sources store vault refs from
    // creation via the fail-closed write path, so there is nothing to convert.

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

      // Store the per-launch token in the vault — "serve-token" class routes to
      // the OS keychain (registered above). No plaintext token persists in a
      // server field; the server resolves it from the vault at each request's
      // auth gate.
      //
      // Two non-happy-path concerns are handled here:
      //   - Stale-entry cleanup: each launch mints a fresh token, so the prior
      //     launch's serve-token mapping row + keychain blob would accumulate
      //     unbounded. We persist the ref in a sidecar marker and delete the
      //     prior entry before storing the new one (overwrite semantics).
      //   - Keychain unavailable: the serve token is EPHEMERAL (regenerated per
      //     launch, never needed across restarts), so when the OS keychain is
      //     unavailable (Linux without libsecret, or the rejected basic_text
      //     backend) we fall back to a process-memory token instead of failing
      //     startup. Plaintext-never-AT-REST holds either way — the fallback
      //     keeps the token only in process memory.
      const authResult = await storeServeToken(
        secretVault as SecretVault,
        project.dir,
        authToken,
      );

      server = await createDashframeServer({
        db: project.db,
        corsOrigin,
        // Vault path passes a ref (no plaintext at the server); the
        // keychain-unavailable fallback passes the plaintext token directly
        // (process-memory only). Exactly one of these is set.
        authRef: authResult.authRef,
        authToken: authResult.authToken,
        arrowEngine: engine,
        // Wire the debounced snapshot scheduler: fire touchSnapshot after every
        // committed artifact-DB write so a crash mid-session loses at most
        // SNAPSHOT_DEBOUNCE_MS (30 s) of changes rather than the whole session.
        // The server owns no reference to ProjectHandle — the narrow callback
        // is the boundary (#88).
        onWrite: () => project.touchSnapshot(),
        // Inject the fully-composed SecretVault. The server RECEIVES this vault;
        // it never instantiates a backend itself. Control-plane mutations
        // (create/update DataSource) call vault.store → ref; reads call
        // vault.has(ref) for presence flags. secretVault is always non-null at
        // this point — it was set immediately before this try block.
        vault: secretVault ?? undefined,
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

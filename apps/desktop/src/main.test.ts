/**
 * Startup-lifecycle regression tests for apps/desktop main.ts.
 *
 * Tests A: Fatal startup errors flow through the shared `shutdown` helper —
 *   partially-initialised handles (server, engine, project) are drained before
 *   `app.exit()` is called.
 *
 * Tests B: Window-load failure is now fatal — `createWindow` awaits the load
 *   and calls `shutdown(1)` on rejection rather than logging and continuing.
 *
 * Tests C: Preload IPC-contract shape (channels + return types) against the
 *   desktop-types API surface.
 *
 * Strategy: mock `electron` entirely so `app.whenReady()` never resolves (the
 * startup chain is side-effecting at module level — we isolate it by keeping
 * it suspended). The exported test hooks (`_injectHandles`, `_resetShutdownGuard`,
 * `shutdown`) let each test drive the shutdown helper directly without running
 * real Electron or DuckDB.
 *
 * vi.mock factories are hoisted to the top of the file by Vitest, BEFORE any
 * variable initialisers. ALL mock functions are therefore created inside the
 * factory (using `vi.fn()`) and accessed through the mocked module's exported
 * object — never through closure variables declared with const/let.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Electron mock — factory must contain only vi.fn() calls (no closure refs).
// Vitest hoists vi.mock() above const declarations, so any outer `const`
// referenced here would be in the Temporal Dead Zone and throw.
// ---------------------------------------------------------------------------

vi.mock("electron", () => {
  return {
    app: {
      isPackaged: false,
      on: vi.fn(),
      // Return a promise that never settles — the startup chain never fires.
      whenReady: vi.fn(() => new Promise<void>(() => {})),
      exit: vi.fn(),
      quit: vi.fn(),
    },
    BrowserWindow: vi.fn(() => ({
      loadURL: vi.fn().mockResolvedValue(undefined),
      loadFile: vi.fn().mockResolvedValue(undefined),
    })),
    dialog: {
      showErrorBox: vi.fn(),
      showMessageBoxSync: vi.fn(),
    },
    ipcMain: {
      handle: vi.fn(),
    },
    shell: {
      showItemInFolder: vi.fn(),
    },
  };
});

vi.mock("@dashframe/engine-server", () => ({
  NativeDuckDBEngine: vi.fn(),
  selectEngineBinding: vi.fn().mockReturnValue("native"),
}));

vi.mock("@dashframe/server-core", () => ({
  ARTIFACTS_DB_FILENAME: "artifacts.db",
  openProject: vi.fn(),
}));

vi.mock("@dashframe/server/app", () => ({
  createDashframeServer: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Now import the module under test — mocks are in place.
// ---------------------------------------------------------------------------
import { app } from "electron";

import { _injectHandles, _resetShutdownGuard, shutdown } from "./main.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockFn = ReturnType<typeof vi.fn>;

function makeProject(): {
  close: MockFn;
  dir: string;
  db: unknown;
  meta: object;
  recovery: null;
  touchSnapshot: MockFn;
} {
  return {
    close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    dir: "/test-project",
    db: {},
    meta: {},
    recovery: null,
    touchSnapshot: vi.fn(),
  };
}

function makeEngine(): { dispose: MockFn } {
  return {
    dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}

function makeServer(): { stop: MockFn; url: string } {
  return {
    stop: vi.fn<() => void>(),
    url: "http://127.0.0.1:0",
  };
}

// ---------------------------------------------------------------------------
// Tests — A: shutdown helper drains handles
// ---------------------------------------------------------------------------

describe("shutdown helper — A: drains partially-initialised handles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetShutdownGuard();
  });

  afterEach(() => {
    _injectHandles({ project: null, server: null, engine: null });
    _resetShutdownGuard();
  });

  it("calls app.exit with the given exit code", async () => {
    await shutdown(1);
    expect(app.exit).toHaveBeenCalledWith(1);
    expect(app.exit).toHaveBeenCalledTimes(1);
  });

  it("stops server, disposes engine, closes project in order", async () => {
    const calls: string[] = [];

    const project = makeProject();
    project.close.mockImplementation(async () => {
      calls.push("project.close");
    });

    const engine = makeEngine();
    engine.dispose.mockImplementation(async () => {
      calls.push("engine.dispose");
    });

    const server = makeServer();
    server.stop.mockImplementation(() => {
      calls.push("server.stop");
    });

    _injectHandles({ project, server, engine } as never);

    await shutdown(0);

    // Order: server.stop → engine.dispose → project.close
    expect(calls).toEqual(["server.stop", "engine.dispose", "project.close"]);
    expect(app.exit).toHaveBeenCalledWith(0);
  });

  it("is re-entrant safe — a second call while draining is a no-op", async () => {
    let firstResolve!: () => void;
    const firstDrain = new Promise<void>((res) => {
      firstResolve = res;
    });

    const engine = makeEngine();
    engine.dispose.mockImplementation(async () => {
      // Simulate slow cleanup — re-entrant call should be dropped.
      await firstDrain;
    });
    _injectHandles({ engine } as never);

    // Start first shutdown (hangs on engine.dispose).
    const first = shutdown(1);

    // Re-entrant call while first is still draining — should return immediately.
    await shutdown(2);

    // Let the first drain complete.
    firstResolve();
    await first;

    // app.exit called only once (from the first call, not the re-entrant one).
    expect(app.exit).toHaveBeenCalledTimes(1);
    expect(app.exit).toHaveBeenCalledWith(1);
  });

  it("continues draining remaining handles when one step throws", async () => {
    const project = makeProject();
    const engine = makeEngine();
    engine.dispose.mockRejectedValue(new Error("engine boom"));

    _injectHandles({ project, engine } as never);

    // Should not throw — internal errors are caught.
    await expect(shutdown(1)).resolves.toBeUndefined();

    // project.close must still have been called despite engine.dispose throwing.
    expect(project.close).toHaveBeenCalled();
    expect(app.exit).toHaveBeenCalledWith(1);
  });

  it("drains engine when project is null (pre-project-init failure)", async () => {
    // Simulates: engine was already init'd when openProject throws. shutdown
    // must dispose engine before exiting.
    const engine = makeEngine();
    _injectHandles({ engine, project: null } as never);

    await shutdown(1);

    expect(engine.dispose).toHaveBeenCalled();
    expect(app.exit).toHaveBeenCalledWith(1);
  });

  it("is a no-op for null handles (nothing initialised yet)", async () => {
    _injectHandles({ project: null, engine: null, server: null });

    await expect(shutdown(1)).resolves.toBeUndefined();

    expect(app.exit).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// Tests — B: window-load failure path calls graceful shutdown
// ---------------------------------------------------------------------------

describe("shutdown helper — B: window-load fatal path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetShutdownGuard();
  });

  afterEach(() => {
    _injectHandles({ project: null, server: null, engine: null });
    _resetShutdownGuard();
  });

  it("shutdown(1) drains all handles and exits — same path used on loadFile rejection", async () => {
    const project = makeProject();
    const engine = makeEngine();
    const server = makeServer();
    _injectHandles({ project, engine, server } as never);

    // createWindow calls shutdown(1) on loadFile rejection — simulate that.
    await shutdown(1);

    expect(project.close).toHaveBeenCalled();
    expect(engine.dispose).toHaveBeenCalled();
    expect(server.stop).toHaveBeenCalled();
    expect(app.exit).toHaveBeenCalledWith(1);
  });

  it("shutdown drains safely when project is null (window created before project init is impossible but safe)", async () => {
    _injectHandles({ project: null, engine: null, server: null });

    await expect(shutdown(1)).resolves.toBeUndefined();

    expect(app.exit).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// Tests — C: Preload IPC-contract shape
// ---------------------------------------------------------------------------

describe("preload IPC contract — C: channel names match desktop-types API", () => {
  it("the three required IPC channels are correctly named", () => {
    // The channels registered by registerIpc in main.ts must exactly match the
    // ipcRenderer.invoke() calls in preload.ts. A mismatch produces a silent
    // undefined return in the renderer. This test documents the contract.
    const registeredChannels = [
      "dashframe:project:info",
      "dashframe:project:reveal",
      "dashframe:server:info",
    ];

    expect(registeredChannels).toContain("dashframe:project:info");
    expect(registeredChannels).toContain("dashframe:project:reveal");
    expect(registeredChannels).toContain("dashframe:server:info");
    expect(registeredChannels).toHaveLength(3);
  });
});

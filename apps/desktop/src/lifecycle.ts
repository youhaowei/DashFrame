import type { NativeDuckDBEngine } from "@dashframe/engine-server";
import type { ProjectHandle } from "@dashframe/server-core";
import type { DashframeServer } from "@dashframe/server/app";

/**
 * The closable handles a launched session owns. The lifecycle controller holds
 * references as they are created during startup and drains them on shutdown.
 *
 * Narrowed to just the methods shutdown calls — the controller never needs the
 * full handle types, and the narrow shape keeps the unit tests honest (a test
 * double only has to implement what shutdown actually touches).
 */
export interface Closable {
  server: Pick<DashframeServer, "stop"> | null;
  engine: Pick<NativeDuckDBEngine, "dispose"> | null;
  project: Pick<ProjectHandle, "close"> | null;
}

/** Terminates the process. Injected so tests can observe the exit code. */
export type Exit = (code: number) => void;

/**
 * Owns the startup-to-shutdown lifecycle state for one app launch.
 *
 * Replaces the module-level mutable handles in main.ts: the controller is the
 * single owner of the `server`/`engine`/`project` references and the
 * shutting-down guard. main.ts holds exactly one instance for the process
 * lifetime; tests construct a fresh instance per case (no reset hooks, no
 * test-only exports on the production entry point).
 */
export class Lifecycle {
  private readonly handles: Closable = {
    server: null,
    engine: null,
    project: null,
  };
  private isShuttingDown = false;

  constructor(private readonly exit: Exit) {}

  setServer(server: Closable["server"]): void {
    this.handles.server = server;
  }

  setEngine(engine: Closable["engine"]): void {
    this.handles.engine = engine;
  }

  setProject(project: Closable["project"]): void {
    this.handles.project = project;
  }

  /** True once a project handle has been registered. */
  hasProject(): boolean {
    return this.handles.project !== null;
  }

  /**
   * Best-effort graceful shutdown.
   *
   * Used by BOTH the normal `before-quit` path AND every startup-error path so
   * partially-initialised handles (engine, project) are never terminated mid-
   * flight without a chance to flush/close. Each step is individually guarded
   * so one failure does not skip the rest. Re-entrant calls (e.g. a
   * `before-quit` firing while a startup-error path is already draining) are
   * no-ops.
   *
   * @param exitCode Exit code to pass to the injected `exit` after cleanup.
   */
  async shutdown(exitCode: number): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    try {
      this.handles.server?.stop();
    } catch (err) {
      console.error("[dashframe] error stopping server:", err);
    }
    try {
      await this.handles.engine?.dispose();
    } catch (err) {
      console.error("[dashframe] error disposing engine:", err);
    }
    try {
      await this.handles.project?.close();
    } catch (err) {
      console.error("[dashframe] error closing project DB:", err);
    }

    this.exit(exitCode);
  }
}

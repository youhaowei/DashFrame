/**
 * Startup-lifecycle regression tests for the desktop Lifecycle controller.
 *
 * The controller owns the shutdown contract that main.ts relies on for both the
 * normal `before-quit` path and every startup-error path. These tests drive it
 * with plain test doubles — no Electron, no DuckDB, no test-only hooks on the
 * production entry point: each case constructs a fresh `Lifecycle`.
 *
 * Contracts under test:
 *   A. shutdown drains server → engine → project, in that order, then exits.
 *   B. shutdown is re-entrant safe (a concurrent second call is a no-op).
 *   C. one failing drain step does not skip the rest.
 *   D. shutdown is safe when handles are partially or fully unset (a startup
 *      error can fire before any handle is registered).
 */
import { describe, expect, it, vi } from "vitest";

import type { CloseResult } from "@dashframe/server-core";
import { Lifecycle } from "./lifecycle.js";

function makeServer(onStop?: () => void): {
  stop: ReturnType<typeof vi.fn<() => void>>;
} {
  return { stop: vi.fn<() => void>(onStop) };
}

function makeEngine(onDispose?: () => void | Promise<void>): {
  dispose: ReturnType<typeof vi.fn<() => Promise<void>>>;
} {
  return {
    dispose: vi.fn<() => Promise<void>>(async () => {
      await onDispose?.();
    }),
  };
}

function makeProject(onClose?: () => void): {
  close: ReturnType<typeof vi.fn<() => Promise<CloseResult>>>;
} {
  return {
    close: vi.fn<() => Promise<CloseResult>>(async () => {
      onClose?.();
      return { snapshotError: null };
    }),
  };
}

describe("Lifecycle.shutdown — A: drain order + exit", () => {
  it("stops server, disposes engine, closes project, then exits with the code", async () => {
    const calls: string[] = [];
    const exit = vi.fn<(code: number) => void>();
    const lifecycle = new Lifecycle(exit);

    lifecycle.setServer(
      makeServer(() => {
        calls.push("server.stop");
      }),
    );
    lifecycle.setEngine(
      makeEngine(() => {
        calls.push("engine.dispose");
      }),
    );
    lifecycle.setProject(
      makeProject(() => {
        calls.push("project.close");
      }),
    );

    await lifecycle.shutdown(0);

    expect(calls).toEqual(["server.stop", "engine.dispose", "project.close"]);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("passes a non-zero exit code through (the startup-error path)", async () => {
    const exit = vi.fn<(code: number) => void>();
    const lifecycle = new Lifecycle(exit);
    lifecycle.setEngine(makeEngine());

    await lifecycle.shutdown(1);

    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});

describe("Lifecycle.shutdown — B: re-entrancy", () => {
  it("drops a second call that arrives while the first is still draining", async () => {
    const exit = vi.fn<(code: number) => void>();
    const lifecycle = new Lifecycle(exit);

    let releaseFirstDrain!: () => void;
    const firstDrain = new Promise<void>((resolve) => {
      releaseFirstDrain = resolve;
    });
    // Engine dispose hangs until we release it — the window where a second
    // shutdown could race in.
    lifecycle.setEngine(makeEngine(() => firstDrain));

    const first = lifecycle.shutdown(1);
    // Second call while the first is mid-drain — must be a no-op.
    await lifecycle.shutdown(2);

    releaseFirstDrain();
    await first;

    // Only the first call's exit code is used; exit fires exactly once.
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});

describe("Lifecycle.shutdown — C: per-step error isolation", () => {
  it("continues draining and still exits when one step throws", async () => {
    const exit = vi.fn<(code: number) => void>();
    const lifecycle = new Lifecycle(exit);

    const server = makeServer(() => {
      throw new Error("server stop boom");
    });
    const engine = makeEngine(() => {
      throw new Error("engine dispose boom");
    });
    const project = makeProject();

    lifecycle.setServer(server);
    lifecycle.setEngine(engine);
    lifecycle.setProject(project);

    await expect(lifecycle.shutdown(1)).resolves.toBeUndefined();

    // Every step ran despite the two earlier throws, and exit still fired.
    expect(server.stop).toHaveBeenCalled();
    expect(engine.dispose).toHaveBeenCalled();
    expect(project.close).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});

describe("Lifecycle.shutdown — D: partial / unset handles", () => {
  it("disposes the engine when the project was never opened (pre-project failure)", async () => {
    const exit = vi.fn<(code: number) => void>();
    const lifecycle = new Lifecycle(exit);
    const engine = makeEngine();
    lifecycle.setEngine(engine);

    await lifecycle.shutdown(1);

    expect(engine.dispose).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("is a no-op drain when nothing is registered, but still exits", async () => {
    const exit = vi.fn<(code: number) => void>();
    const lifecycle = new Lifecycle(exit);

    await expect(lifecycle.shutdown(1)).resolves.toBeUndefined();

    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});

describe("Lifecycle.hasProject", () => {
  it("is false until a project is registered, true after", () => {
    const lifecycle = new Lifecycle(vi.fn());
    expect(lifecycle.hasProject()).toBe(false);

    lifecycle.setProject(makeProject());
    expect(lifecycle.hasProject()).toBe(true);
  });
});

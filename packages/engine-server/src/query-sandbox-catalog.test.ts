import { describe, expect, it } from "vite-plus/test";

import {
  WorkspaceQueryEngine,
  type QuerySandboxConfiguration,
} from "./query-sandbox";

/**
 * The registered-table projection is pure bookkeeping over acknowledged worker
 * replies, so it is exercised here without a worker — the sandbox integration
 * suite is Linux-only, and this contract is not.
 */
const configuration: QuerySandboxConfiguration = {
  launcher: "/unused/launcher",
  runtime: "/unused/node",
  worker: "/unused/worker",
  readPaths: [],
  uid: 65534,
  gid: 65534,
  addressSpaceBytes: 1024,
  cpuSeconds: 1,
  uidTaskLimit: 32,
};

/** Acknowledge every request without starting the worker process. */
function acknowledging(): WorkspaceQueryEngine {
  const engine = new WorkspaceQueryEngine("workspace", configuration);
  (engine as unknown as { request: () => Promise<Uint8Array> }).request =
    async () => new Uint8Array();
  return engine;
}

describe("WorkspaceQueryEngine — registered-table projection", () => {
  it("identifies tables the way the worker's DuckDB does, not by spelling", async () => {
    // The worker runs DuckDB, whose identifiers are case-insensitive even when
    // quoted. A raw-keyed projection would report two tables for the worker's
    // one, and unregistering either spelling would leave the other claiming a
    // table the worker has dropped.
    const engine = acknowledging();
    await engine.registerArrowTable("Sales", new Uint8Array([1]));
    expect(engine.hasTable("SALES")).toBe(true);

    await engine.registerArrowTable("sales", new Uint8Array([1]));
    expect(engine.getTableNames()).toEqual(["sales"]);

    await engine.unregisterTable("SaLeS");
    expect(engine.hasTable("Sales")).toBe(false);
    expect(engine.getTableNames()).toEqual([]);
  });

  it("keeps names DuckDB keeps apart apart, folding only ASCII case", async () => {
    const engine = acknowledging();
    await engine.registerArrowTable("Ä", new Uint8Array([1]));
    await engine.registerArrowTable("ä", new Uint8Array([1]));
    expect(engine.getTableNames().sort()).toEqual(["ä", "Ä"].sort());
    await engine.unregisterTable("Ä");
    expect(engine.hasTable("ä")).toBe(true);
    expect(engine.hasTable("Ä")).toBe(false);
  });

  it("forgets every registration once the worker is gone", async () => {
    const engine = acknowledging();
    await engine.registerArrowTable("orders", new Uint8Array([1]));
    await engine.dispose();
    expect(engine.getTableNames()).toEqual([]);
    expect(engine.hasTable("orders")).toBe(false);
  });

  it("forgets them however the worker died, not only on dispose()", async () => {
    // dispose() is one of several ways this engine ends: idle expiry, an
    // operation timeout, a protocol violation and the worker exiting all retire
    // it through the same internal failure path. The worker's catalog dies with
    // it every time, so the projection must not survive any of them.
    const engine = acknowledging();
    await engine.registerArrowTable("orders", new Uint8Array([1]));
    (engine as unknown as { fail: (error: Error) => void }).fail(
      new Error("SANDBOX_IDLE"),
    );
    expect(engine.getTableNames()).toEqual([]);
    expect(engine.hasTable("orders")).toBe(false);
  });

  it("joins a chunked source and enforces the size ceiling on the running total", async () => {
    const engine = acknowledging();
    const sent: Uint8Array[] = [];
    (
      engine as unknown as {
        registerArrowTable: (n: string, b: Uint8Array) => Promise<void>;
      }
    ).registerArrowTable = async (_name, bytes) => {
      sent.push(bytes);
    };
    await engine.registerArrowStream(
      "joined",
      (async function* () {
        yield new Uint8Array([1, 2]);
        yield new Uint8Array([3]);
      })(),
    );
    expect(sent).toEqual([new Uint8Array([1, 2, 3])]);

    let pulled = 0;
    await expect(
      engine.registerArrowStream(
        "oversized",
        (async function* () {
          while (true) {
            pulled += 1;
            yield new Uint8Array(8 * 1024 * 1024);
          }
        })(),
      ),
    ).rejects.toThrow("SANDBOX_MESSAGE_LIMIT");
    // Rejected on the chunk that crossed the ceiling, not after joining it all.
    expect(pulled).toBe(5);
  });
});

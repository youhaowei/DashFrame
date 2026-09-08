import { execFileSync } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tableFromArrays, tableFromIPC, tableToIPC } from "apache-arrow";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vite-plus/test";
import {
  linuxQuerySandboxReadPaths,
  WorkspaceQueryEngine,
  WorkspaceQueryEngines,
  type QuerySandboxConfiguration,
} from "./query-sandbox";
import { encodeFrame } from "./sandbox-protocol";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const node = process.execPath;
let output = "";
let configuration: QuerySandboxConfiguration;
const engines: WorkspaceQueryEngine[] = [];
const brokers: WorkspaceQueryEngines[] = [];

function engine(
  workspaceId: string,
  options: Partial<QuerySandboxConfiguration> = {},
): WorkspaceQueryEngine {
  const instance = new WorkspaceQueryEngine(workspaceId, {
    ...configuration,
    ...options,
  });
  engines.push(instance);
  return instance;
}

function rows(bytes: Uint8Array): unknown[] {
  return tableFromIPC(bytes)
    .toArray()
    .map((row) => row.toJSON());
}

// Desktop keeps its existing native engine; the hosted adapter is Linux-only.
describe.skipIf(process.platform !== "linux")(
  "Linux workspace query sandbox",
  () => {
    beforeAll(async () => {
      output = execFileSync(
        node,
        [resolve(root, "scripts/build-query-sandbox.ts")],
        { cwd: root, encoding: "utf8" },
      )
        .trim()
        .split("\n")
        .at(-1)!;
      configuration = {
        launcher: resolve(output, "query-launcher"),
        runtime: node,
        worker: resolve(output, "worker.cjs"),
        uid: process.getuid!(),
        gid: process.getgid!(),
        addressSpaceBytes: 2 * 1024 * 1024 * 1024,
        cpuSeconds: 30,
        uidTaskLimit: 4096,
        readPaths: await linuxQuerySandboxReadPaths(node, output),
      };
    }, 60_000);

    afterEach(async () => {
      await Promise.all(
        [...engines.splice(0), ...brokers.splice(0)].map((instance) =>
          instance.dispose(),
        ),
      );
    });

    afterAll(async () => {
      if (output) await rm(output, { recursive: true, force: true });
    });

    it("runs joins and aggregates while catalogs with identical names stay separate", async () => {
      const a = engine("a");
      const b = engine("b");
      await Promise.all([a.initialize(), b.initialize()]);
      const orders = tableToIPC(
        tableFromArrays({ region_id: [1, 1, 2], amount: [10, 5, 7.25] }),
      );
      const regions = tableToIPC(
        tableFromArrays({ id: [1, 2], name: ["West", "East"] }),
      );
      await Promise.all([
        a.registerArrowTable("orders", orders),
        a.registerArrowTable("regions", regions),
        b.registerArrowTable(
          "orders",
          tableToIPC(tableFromArrays({ amount: [999] })),
        ),
        b.registerArrowTable(
          "b_private",
          tableToIPC(tableFromArrays({ marker: ["B only"] })),
        ),
      ]);
      expect(
        rows(
          await a.queryArrow(
            "SELECT name, count(*)::INTEGER AS n, sum(amount) AS total FROM orders JOIN regions ON region_id=id GROUP BY name ORDER BY total DESC",
          ),
        ),
      ).toEqual([
        { name: "West", n: 2, total: 15 },
        { name: "East", n: 1, total: 7.25 },
      ]);
      expect(
        rows(await b.queryArrow("SELECT sum(amount) AS total FROM orders")),
      ).toEqual([{ total: 999 }]);
      await expect(a.queryArrow("SELECT * FROM b_private")).rejects.toThrow(
        "SANDBOX_QUERY_FAILED",
      );
      expect(
        rows(
          await a.queryArrow(
            "SELECT '?' AS literal, ?::VARCHAR AS value, ?::BIGINT::VARCHAR AS n",
            ["bound", 9007199254740993n],
          ),
        )[0],
      ).toEqual({ literal: "?", value: "bound", n: "9007199254740993" });
      await a.unregisterTable("orders");
      await expect(a.queryArrow("SELECT * FROM orders")).rejects.toThrow();
      expect(rows(await b.queryArrow("SELECT amount FROM orders"))).toEqual([
        { amount: 999 },
      ]);
    }, 90_000);

    it("denies SQL file/network/config/extension escape and excessive result rows", async () => {
      const a = engine("denial");
      for (const sql of [
        "SELECT * FROM read_text('/etc/passwd')",
        "SELECT * FROM read_csv('/proc/self/environ')",
        "SELECT * FROM read_parquet('http://127.0.0.1/private')",
        "ATTACH '/tmp/sandbox-should-not-exist.db' AS outside",
        "COPY (SELECT 1) TO '/tmp/sandbox-should-not-exist.csv'",
        "INSTALL httpfs",
        "LOAD httpfs",
        "SET enable_external_access=true",
        "SELECT * FROM range(100001)",
      ])
        await expect(a.queryArrow(sql)).rejects.toThrow("SANDBOX_QUERY_FAILED");
      expect(rows(await a.queryArrow("SELECT 42 AS ok"))).toEqual([{ ok: 42 }]);
    });

    it("kills a timed-out query and keeps another workspace usable", async () => {
      const a = engine("timeout", { operationTimeoutMs: 200 });
      const b = engine("survivor");
      await Promise.all([a.initialize(), b.initialize()]);
      await expect(
        a.queryArrow(
          "SELECT sum(a.range * b.range) FROM range(10000000) a, range(10000000) b",
        ),
      ).rejects.toThrow("SANDBOX_OPERATION_TIMEOUT");
      await a.dispose();
      expect(a.isClosed()).toBe(true);
      expect(rows(await b.queryArrow("SELECT 7 AS ok"))).toEqual([{ ok: 7 }]);
    });

    it("cancellation destroys the whole disposable catalog", async () => {
      const a = engine("cancel");
      await a.initialize();
      const controller = new AbortController();
      const query = a.queryArrow(
        "SELECT count(*) FROM range(1000000000) a, range(1000000000) b",
        [],
        controller.signal,
      );
      controller.abort();
      await expect(query).rejects.toThrow("SANDBOX_CANCELLED");
      await a.dispose();
      await expect(a.queryArrow("SELECT 1")).rejects.toThrow(
        "SANDBOX_CANCELLED",
      );
    });

    it("rejects missing policy paths, malformed worker frames and worker crashes", async () => {
      await expect(
        engine("missing", {
          readPaths: [
            ...configuration.readPaths,
            "/nonexistent/query-sandbox-required",
          ],
        }).initialize(),
      ).rejects.toThrow("SANDBOX_START_FAILED");
      const hostile = resolve(output, "hostile.cjs");
      await writeFile(
        hostile,
        "const h=Buffer.alloc(8);h.writeUInt32BE(2,0);h.writeUInt32BE(0xffffffff,4);process.stdout.write(h);setInterval(()=>{},1000);",
      );
      const bad = engine("bad-protocol", { worker: hostile });
      await expect(bad.initialize()).rejects.toThrow("SANDBOX_PROTOCOL_ERROR");
      await bad.dispose();
      const crash = resolve(output, "crash.cjs");
      await writeFile(crash, "process.exit(42)");
      await expect(
        engine("crash", { worker: crash }).initialize(),
      ).rejects.toThrow(/SANDBOX_(WORKER_EXITED|TRANSPORT_CLOSED)/);
    });

    it("bounds broker capacity and makes closed handles unusable", async () => {
      const broker = new WorkspaceQueryEngines(configuration, 1);
      brokers.push(broker);
      const first = broker.forWorkspace("first");
      expect(broker.forWorkspace("first")).toBe(first);
      expect(() => broker.forWorkspace("second")).toThrow("SANDBOX_CAPACITY");
      await broker.dispose();
      expect(() => broker.forWorkspace("first")).toThrow("SANDBOX_CLOSED");
      await expect(first.initialize()).rejects.toThrow("SANDBOX_CLOSED");
    });

    it("bounds queued work, rejects every pending operation on cancel, and reaps before replacing", async () => {
      const broker = new WorkspaceQueryEngines(configuration, 1);
      brokers.push(broker);
      const a = broker.forWorkspace("queue");
      await a.initialize();
      const controller = new AbortController();
      const pending = [
        a.queryArrow(
          "SELECT count(*) FROM range(1000000000) a, range(1000000000) b",
          [],
          controller.signal,
        ),
      ];
      for (let i = 0; i < 7; i++) pending.push(a.queryArrow("SELECT 1"));
      const settled = Promise.allSettled(pending);
      await expect(a.queryArrow("SELECT 2")).rejects.toThrow(
        "SANDBOX_QUEUE_FULL",
      );
      controller.abort();
      expect(() => broker.forWorkspace("replacement")).toThrow(
        "SANDBOX_CAPACITY",
      );
      expect(
        (await settled).every((result) => result.status === "rejected"),
      ).toBe(true);
      await a.dispose();
      const replacement = broker.forWorkspace("replacement");
      expect(rows(await replacement.queryArrow("SELECT 3 AS fresh"))).toEqual([
        { fresh: 3 },
      ]);
      await broker.dispose();
    });

    it("evicts an idle worker and leaves its old handle closed", async () => {
      const a = engine("idle", { idleTimeoutMs: 20 });
      await a.initialize();
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
      await expect(a.queryArrow("SELECT 1")).rejects.toThrow("SANDBOX_IDLE");
      await a.dispose();
      expect(a.isReaped()).toBe(true);
    });

    it("retires a worker that sends valid frames with operation-incompatible success payloads", async () => {
      const ready = encodeFrame({
        version: 1,
        id: 0,
        status: "ready",
      }).toString("base64");
      for (const kind of ["query", "register"] as const) {
        const response = encodeFrame(
          { version: 1, id: 1, status: "ok" },
          new Uint8Array([1, 2, 3, 4]),
        ).toString("base64");
        const worker = resolve(output, `bad-${kind}.cjs`);
        await writeFile(
          worker,
          `process.stdin.once('data',()=>process.stdout.write(Buffer.from(${JSON.stringify(response)},'base64')));process.stdout.write(Buffer.from(${JSON.stringify(ready)},'base64'));setInterval(()=>{},1000);`,
        );
        const bad = engine(`bad-${kind}`, { worker });
        const operation =
          kind === "query"
            ? bad.queryArrow("SELECT 1")
            : bad.registerArrowTable(
                "x",
                tableToIPC(tableFromArrays({ x: [1] })),
              );
        await expect(operation).rejects.toThrow("SANDBOX_PROTOCOL_ERROR");
        await bad.dispose();
        expect(bad.isClosed()).toBe(true);
      }
    });
  },
);

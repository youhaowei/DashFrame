/**
 * End-to-end smoke check for the desktop engine seam: boots the real loopback
 * server backed by native DuckDB and an local Convex project, then exercises
 * the Arrow IPC data path over HTTP with the loopback bearer token — proving
 * that the reachable server engine binds and runs, that Arrow bytes cross the
 * wire, and that token auth holds.
 *
 * Two HTTP surfaces, because they prove different things:
 *
 *   1. The real `createDashframeServer`, which is where the data path is
 *      actually mounted. Auth enforcement and the absence of the retired raw
 *      routes are checked there.
 *   2. A directly mounted `createArrowDataPath` over the SAME engine, with a
 *      stub frame store. Every surviving route is addressed by frame id and its
 *      ownership check reads Convex DataFrame metadata, which a bare project has
 *      none of — so driving `POST /frames/:id/mosaic` end to end needs a store
 *      this script owns.
 */
import {
  createArrowDataPath,
  frameTableName,
  NativeDuckDBEngine,
} from "@dashframe/engine-server";
import { serve as nodeServe } from "@hono/node-server";
import { openLocalProject } from "@dashframe/server-core";
import { createDashframeServer } from "@dashframe/server/app";
import { tableFromArrays, tableFromIPC, tableToIPC } from "apache-arrow";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "engine-verify-"));
const token = randomBytes(32).toString("base64url");

// Resources acquired inside run(); released in the finally below so a failed
// assertion can't leave a listening server, an open engine, or a temp dir.
let project = null;
let engine = null;
let server = null;
let framePath = null;

const FRAME_ID = "11111111-1111-4111-8111-111111111111";
const FRAME_TABLE = frameTableName(FRAME_ID);

async function run() {
  project = await openLocalProject({ dir, name: "verify" });
  engine = new NativeDuckDBEngine();
  await engine.initialize();
  console.log(
    `[verify] native DuckDB engine ready: isReady=${engine.isReady()}`,
  );

  server = await createDashframeServer({
    project,
    authToken: token,
    arrowEngine: engine,
  });
  console.log(`[verify] loopback server listening: ${server.url}`);

  // 1) Auth required on the real server: no token → 401, engine not run.
  const noAuth = await fetch(`${server.url}/data/frames/${FRAME_ID}/mosaic`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "arrow", sql: "SELECT 1" }),
  });
  console.log(
    `[verify] no-token request status: ${noAuth.status} (expect 401)`,
  );
  if (noAuth.status !== 401) throw new Error("data path did not require auth");

  // 2) The retired raw routes are gone from the mounted path.
  for (const route of ["/data/arrow", "/data/tables/orders"]) {
    const retired = await fetch(`${server.url}${route}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ sql: "SELECT 1" }),
    });
    console.log(`[verify] retired ${route}: ${retired.status} (expect 404)`);
    if (retired.status !== 404) throw new Error(`${route} is still routed`);
  }

  // 3) The Mosaic route end to end, over real HTTP, against the same engine.
  //    The route registers the stored frame under its canonical table name,
  //    and the SQL names that table directly — the server does no rewriting.
  const frameBytes = tableToIPC(
    tableFromArrays({
      id: Int32Array.from([0, 1, 2, 3, 4]),
      label: ["order-0", "order-1", "order-2", "order-3", "order-4"],
      amount: Float64Array.from([0, 1.5, 3, 4.5, 6]),
    }),
    "stream",
  );
  const frameApp = createArrowDataPath({
    engine,
    authToken: token,
    isFrameAvailable: async (id) => id === FRAME_ID,
    dataFrameStorage: {
      save: async () => {},
      load: async (id) => (id === FRAME_ID ? frameBytes : null),
      delete: async () => {},
      exists: async () => true,
      list: async () => [FRAME_ID],
      getUsage: async () => ({ count: 1 }),
    },
  });
  // Served the way the product serves Hono apps (`@hono/node-server`), so this
  // is a real socket, not an in-process `app.request()`.
  const framePort = await new Promise((resolve) => {
    framePath = nodeServe(
      { fetch: frameApp.fetch, hostname: "127.0.0.1", port: 0 },
      (info) => resolve(info.port),
    );
  });
  const frameOrigin = `http://127.0.0.1:${framePort}`;
  console.log(`[verify] frame path listening: ${frameOrigin}`);

  const res = await fetch(`${frameOrigin}/frames/${FRAME_ID}/mosaic`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      type: "arrow",
      sql: `SELECT id, label FROM "${FRAME_TABLE}" ORDER BY id`,
    }),
  });
  console.log(`[verify] authed request status: ${res.status} (expect 200)`);
  console.log(`[verify] content-type: ${res.headers.get("content-type")}`);
  if (res.status !== 200) throw new Error("authed data path request failed");

  const raw = await res.arrayBuffer();
  if (res.headers.get("content-type") !== "application/vnd.apache.arrow.stream")
    throw new Error(
      `expected Arrow IPC, got ${res.headers.get("content-type")}: ${new TextDecoder().decode(raw)}`,
    );
  const bytes = new Uint8Array(raw);
  console.log(`[verify] Arrow IPC bytes received: ${bytes.byteLength}`);

  const table = tableFromIPC(bytes);
  console.log(
    `[verify] decoded Arrow table: ${table.numRows} rows, columns=[${table.schema.fields.map((f) => f.name).join(", ")}]`,
  );
  console.log("[verify] first 3 rows:");
  for (let i = 0; i < Math.min(3, table.numRows); i++) {
    const row = table.get(i);
    console.log(`  ${JSON.stringify(row?.toJSON())}`);
  }

  if (table.numRows !== 5) throw new Error("unexpected row count");
  if (table.getChild("label")?.get(0) !== "order-0")
    throw new Error("unexpected Arrow value");
}

try {
  await run();
  console.log(
    "\n[verify] PASS — server engine bound and initialized, Arrow IPC streamed over loopback HTTP from the frame route, retired raw routes gone, token auth enforced, result decoded.",
  );
} finally {
  framePath?.close();
  await server?.stop();
  await engine?.dispose();
  await project?.close();
  await fs.rm(dir, { recursive: true, force: true });
}

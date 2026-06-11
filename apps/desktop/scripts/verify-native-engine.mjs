/**
 * End-to-end smoke check for the desktop engine seam: boots the real loopback
 * server backed by native DuckDB and an on-disk PGLite project, then exercises
 * the Arrow IPC data path over HTTP with the loopback bearer token — proving
 * engine selection, Arrow bytes over the wire, and token auth.
 */
import {
  NativeDuckDBEngine,
  selectEngineBinding,
} from "@dashframe/engine-server";
import { openProject } from "@dashframe/server-core";
import { createDashframeServer } from "@dashframe/server/app";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

// apache-arrow resolves from the engine-server package (its direct dep); the
// desktop app doesn't depend on it directly, so resolve it from there.
const requireFromEngineServer = createRequire(
  new URL("../../../packages/engine-server/package.json", import.meta.url),
);
const { tableFromIPC } = requireFromEngineServer("apache-arrow");

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "engine-verify-"));
const token = randomBytes(32).toString("base64url");

const binding = selectEngineBinding("desktop");
console.log(`[verify] engine binding (desktop): ${binding}`);
if (binding !== "native") throw new Error("expected native binding on desktop");

const project = await openProject({ dir, name: "verify" });
const engine = new NativeDuckDBEngine();
await engine.initialize();
console.log(`[verify] native DuckDB engine ready: isReady=${engine.isReady()}`);

const server = await createDashframeServer({
  db: project.db,
  authToken: token,
  arrowEngine: engine,
});
console.log(`[verify] loopback server listening: ${server.url}`);

// 1) Auth required: no token → 401, engine not run.
const noAuth = await fetch(`${server.url}/data/arrow`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sql: "SELECT 1" }),
});
console.log(`[verify] no-token request status: ${noAuth.status} (expect 401)`);
if (noAuth.status !== 401) throw new Error("data path did not require auth");

// 2) Valid token → Arrow IPC stream over HTTP.
const res = await fetch(`${server.url}/data/arrow`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    sql: "SELECT range::int AS id, ('order-' || range) AS label, (range * 1.5)::double AS amount FROM range(5)",
    params: [],
  }),
});
console.log(`[verify] authed request status: ${res.status} (expect 200)`);
console.log(`[verify] content-type: ${res.headers.get("content-type")}`);
if (res.status !== 200) throw new Error("authed data path request failed");

const bytes = new Uint8Array(await res.arrayBuffer());
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

server.stop();
await engine.dispose();
await project.close();
await fs.rm(dir, { recursive: true, force: true });
console.log(
  "\n[verify] PASS — native engine selected, Arrow IPC streamed over loopback HTTP, token auth enforced, result decoded.",
);

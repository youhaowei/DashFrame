/**
 * REAL-PG: preview (`query`) and stream (`queryBatches`) of tables whose
 * columns use OIDs outside `pgOidToColumnType` (arrays, jsonb). Only a live
 * server exercises node-postgres's type parsers, which the spy clients in
 * connector.test.ts bypass.
 *
 * Auto-skips when PG_DSN is absent. To run locally:
 *   PG_DSN=postgresql://postgres@127.0.0.1:5432/postgres \
 *     bun run --cwd packages/connector-postgres vp test run column-types.realpg
 */
import type { ConnectorQueryResult, SecretResolver } from "@dashframe/engine";
import { tableFromIPC } from "apache-arrow";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { makePostgresConnector } from "./connector.js";

const DSN = process.env["PG_DSN"];
const suite = DSN ? describe : describe.skip;
const resolver: SecretResolver = (use) => use(DSN ?? "");
// A schema of this run's own, so setup and cleanup never touch existing tables.
const SCHEMA = `dashframe_realpg_${crypto.randomUUID().replaceAll("-", "")}`;

async function admin(sql: string): Promise<void> {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: DSN });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

function decode(result: ConnectorQueryResult) {
  const table = tableFromIPC(Buffer.from(result.arrowBuffer, "base64"));
  return {
    fieldTypes: result.fields.map((field) => [field.name, field.type]),
    arrowTypes: table.schema.fields.map((field) => String(field.type)),
    rows: table.toArray().map((row) => ({ ...row.toJSON() })),
  };
}

async function previewAndStream(table: string) {
  const connector = makePostgresConnector(resolver, {
    defaultSchema: SCHEMA,
  });
  const tableId = crypto.randomUUID();
  const preview = await connector.query(`${SCHEMA}.${table}`, tableId);
  const batches: ConnectorQueryResult[] = [];
  for await (const batch of connector.queryBatches(
    `${SCHEMA}.${table}`,
    tableId,
  )) {
    batches.push(batch);
  }
  expect(batches).toHaveLength(1);
  return { preview: decode(preview), stream: decode(batches[0]!) };
}

suite("REAL-PG: columns with unmapped OIDs import as text", () => {
  beforeAll(async () => {
    await admin(`
      CREATE SCHEMA ${SCHEMA};
      SET search_path TO ${SCHEMA};
      CREATE TABLE types_null_array (id int, tags text[]);
      INSERT INTO types_null_array VALUES (1, NULL);
      CREATE TABLE types_array (id int, tags text[]);
      INSERT INTO types_array VALUES (1, '{a,b}'), (2, '{c}');
      CREATE TABLE types_json (id int, ok boolean, doc jsonb);
      INSERT INTO types_json VALUES (1, true, '{"a": 1}'), (2, false, NULL);
    `);
  });

  afterAll(async () => {
    await admin(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  });

  it("types an all-NULL text[] column as string in both paths", async () => {
    const { preview, stream } = await previewAndStream("types_null_array");
    expect(preview.fieldTypes).toEqual([
      ["id", "number"],
      ["tags", "string"],
    ]);
    expect(stream).toEqual(preview);
  });

  it("delivers text[] values as Postgres array text", async () => {
    const { preview, stream } = await previewAndStream("types_array");
    expect(preview.rows).toEqual([
      { id: 1, tags: "{a,b}" },
      { id: 2, tags: "{c}" },
    ]);
    expect(stream).toEqual(preview);
  });

  it("delivers jsonb values as JSON text and keeps mapped types parsed", async () => {
    const { preview, stream } = await previewAndStream("types_json");
    expect(preview.fieldTypes).toEqual([
      ["id", "number"],
      ["ok", "boolean"],
      ["doc", "string"],
    ]);
    expect(preview.rows).toEqual([
      { id: 1, ok: true, doc: '{"a": 1}' },
      { id: 2, ok: false, doc: null },
    ]);
    expect(stream).toEqual(preview);
  });
});

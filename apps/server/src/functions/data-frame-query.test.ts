import { duckdbColumnsToArrowIpc } from "@dashframe/engine-server";
import { openArtifactDb, schema } from "@dashframe/server-core";
import type { Principal } from "@wystack/identity";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { wy } from "../wystack";
import { dataFrameQueryFunctions } from "./data-frame-query";

const user: Principal = { kind: "user", userId: "local-user" };

describe("queryDataFrame", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-frame-query-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
  });
  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads a bounded page through the server-owned table and rejects unsafe sorts", async () => {
    const id = crypto.randomUUID();
    await db.insert(schema.dataFrames).values({
      id,
      storage: { type: "file", key: id },
      fieldIds: [
        "10000000-0000-4000-8000-000000000001",
        "10000000-0000-4000-8000-000000000002",
      ],
      name: "Revenue",
      rowCount: 2,
      columnCount: 2,
      analysis: {
        schema: [
          {
            id: "10000000-0000-4000-8000-000000000001",
            name: "country",
            type: "string",
          },
          {
            id: "10000000-0000-4000-8000-000000000002",
            name: "Revenue ($)",
            type: "number",
          },
        ],
      },
    });
    const registerArrowTable = vi.fn(async () => {});
    const queryArrow = vi.fn(async (sql: string) =>
      duckdbColumnsToArrowIpc(
        sql.includes("COUNT(*)")
          ? [{ name: "count", typeId: 4, values: [2] }]
          : [
              { name: "country", typeId: 17, values: ["CA"] },
              { name: "revenue", typeId: 4, values: [12] },
            ],
      ),
    );
    const app = await wy.build({ db, functions: dataFrameQueryFunctions });
    const storage = {
      load: vi.fn(async () => new Uint8Array([1])),
    };
    const call = (args: Record<string, unknown>) =>
      app.call("queryDataFrame", args, {
        principal: user,
        dataFrameStorage: storage as never,
        dataPlaneRuntime: { queryArrow, registerArrowTable },
      });

    const ready = await call({
      dataFrameId: id,
      offset: 1,
      limit: 1,
      sort: [
        {
          fieldId: "10000000-0000-4000-8000-000000000002",
          direction: "desc",
        },
      ],
    });
    expect(ready.result).toMatchObject({
      status: "ready",
      rows: [{ country: "CA", revenue: 12 }],
      totalCount: 2,
      page: { offset: 1, limit: 1, returned: 1 },
    });
    expect(registerArrowTable).toHaveBeenCalledWith(
      `df_${id.replaceAll("-", "_")}`,
      expect.any(Uint8Array),
    );
    expect(queryArrow).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY "Revenue ($)" DESC LIMIT ? OFFSET ?'),
      [1, 1],
    );

    const unsafe = await call({
      dataFrameId: id,
      sort: [{ fieldId: 'revenue"; DROP TABLE x; --', direction: "asc" }],
    });
    expect(unsafe.result).toMatchObject({ code: "QUERY_SORT_NOT_ALLOWED" });

    const resultId = crypto.randomUUID();
    const resultFieldId = "field_20000000_0000_4000_8000_000000000001";
    await db.insert(schema.dataFrames).values({
      id: resultId,
      storage: { type: "file", key: resultId },
      fieldIds: [resultFieldId],
      name: "Insight result",
      rowCount: 2,
      columnCount: 1,
      analysis: {
        schema: [{ id: resultFieldId, name: "Revenue ($)", type: "number" }],
        definitionFingerprint: "result-frame",
      },
    });
    queryArrow.mockClear();
    const sortedResult = await call({
      dataFrameId: resultId,
      sort: [{ fieldId: resultFieldId, direction: "asc" }],
    });
    expect(sortedResult.result).toMatchObject({ status: "ready" });
    expect(queryArrow).toHaveBeenCalledWith(
      expect.stringContaining(
        `ORDER BY "${resultFieldId}" ASC LIMIT ? OFFSET ?`,
      ),
      [100, 0],
    );

    queryArrow.mockClear();
    const deepPage = await call({
      dataFrameId: id,
      offset: 100_001,
      limit: 1,
    });
    expect(deepPage.result).toMatchObject({ status: "ready" });
    expect(queryArrow).toHaveBeenCalledWith(
      expect.stringContaining("LIMIT ? OFFSET ?"),
      [1, 100_001],
    );
  });

  it("does not query a frame revoked while its bytes are being registered", async () => {
    const id = crypto.randomUUID();
    await db.insert(schema.dataFrames).values({
      id,
      storage: { type: "file", key: id },
      fieldIds: ["10000000-0000-4000-8000-000000000001"],
      name: "Revoked",
      rowCount: 1,
      columnCount: 1,
      analysis: {
        schema: [
          {
            id: "10000000-0000-4000-8000-000000000001",
            name: "value",
            type: "number",
          },
        ],
      },
    });
    const queryArrow = vi.fn();
    const unregisterTable = vi.fn(async () => {});
    const registerArrowTable = vi.fn(async () => {
      await db.delete(schema.dataFrames).where(eq(schema.dataFrames.id, id));
    });
    const app = await wy.build({ db, functions: dataFrameQueryFunctions });

    const response = await app.call(
      "queryDataFrame",
      { dataFrameId: id },
      {
        principal: user,
        dataFrameStorage: {
          load: vi.fn(async () => new Uint8Array([1])),
        } as never,
        dataPlaneRuntime: {
          queryArrow,
          registerArrowTable,
          unregisterTable,
        },
      },
    );

    expect(response.result).toMatchObject({
      status: "failed",
      code: "FRAME_NOT_FOUND",
    });
    expect(unregisterTable).toHaveBeenCalledWith(
      `df_${id.replaceAll("-", "_")}`,
    );
    expect(queryArrow).not.toHaveBeenCalled();
  });

  it("does not return bytes when a frame is revoked during the query", async () => {
    const id = crypto.randomUUID();
    await db.insert(schema.dataFrames).values({
      id,
      storage: { type: "file", key: id },
      fieldIds: ["10000000-0000-4000-8000-000000000001"],
      name: "Revoked during read",
      rowCount: 1,
      columnCount: 1,
      analysis: {
        schema: [
          {
            id: "10000000-0000-4000-8000-000000000001",
            name: "value",
            type: "number",
          },
        ],
      },
    });
    let deleted = false;
    const queryArrow = vi.fn(async (sql: string) => {
      if (!deleted && sql.includes("SELECT *")) {
        deleted = true;
        await db.delete(schema.dataFrames).where(eq(schema.dataFrames.id, id));
      }
      return duckdbColumnsToArrowIpc(
        sql.includes("COUNT(*)")
          ? [{ name: "count", typeId: 4, values: [1] }]
          : [{ name: "value", typeId: 4, values: [42] }],
      );
    });
    const unregisterTable = vi.fn(async () => {});
    const app = await wy.build({ db, functions: dataFrameQueryFunctions });

    const response = await app.call(
      "queryDataFrame",
      { dataFrameId: id },
      {
        principal: user,
        dataFrameStorage: {
          load: vi.fn(async () => new Uint8Array([1])),
        } as never,
        dataPlaneRuntime: {
          queryArrow,
          registerArrowTable: vi.fn(async () => {}),
          unregisterTable,
        },
      },
    );

    expect(response.result).toMatchObject({
      status: "failed",
      code: "FRAME_NOT_FOUND",
    });
    expect(response.result).not.toHaveProperty("rows");
    expect(unregisterTable).toHaveBeenCalledOnce();
  });
});
